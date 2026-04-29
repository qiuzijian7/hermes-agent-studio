"""
tools/employee_script_tool.py

Agent tool: `run_employee_script` — lets an employee/agent run a Python script
from its own `scripts/` directory (or its workspace/preset `scripts/`).

This is a thin wrapper around `hermes-webui-studio/api/employee_scripts.py` —
the heavy lifting (sandboxing, timeouts, path validation, docker vs local) is
in that module. Here we just:
  1. Dynamically locate the webui-studio root (via env HERMES_WEBUI_ROOT or
     the sibling `hermes-webui-studio/` directory next to the agent).
  2. Import `execute_script` from it.
  3. Register a `run_employee_script` tool schema with `tools.registry`.

This way the tool is available on *every* agent session once the hermes-agent
process boots, regardless of which platform (CLI / gateway / webui) is driving
the conversation. If the webui module is unavailable (e.g. hermes-agent is
used standalone), the tool simply returns a helpful error instead of crashing.

Schema (as seen by the LLM):

    run_employee_script(
        scope:      "employee" | "workspace" | "preset",
        script_name: str,          # e.g. "generate_sprint_plan.py"
        args:       dict,          # optional, passed as stdin JSON
        timeout:    int,           # optional, seconds (max 600)
    ) -> {success, exit_code, stdout, stderr, duration_ms}

Calling context (emp_id / workspace) is auto-injected by the platform layer
into kwargs of the handler — the LLM does not have to (and cannot easily)
forge arbitrary paths.
"""
from __future__ import annotations

import importlib.util
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 60
_MAX_TIMEOUT = 600


# ── Locate webui-studio / employee_scripts module ──────────────────────────

def _locate_webui_root() -> Optional[Path]:
    """Return the hermes-webui-studio directory, or None if not found."""
    env = os.getenv("HERMES_WEBUI_ROOT", "").strip()
    if env:
        p = Path(env).expanduser().resolve()
        if (p / "api" / "employee_scripts.py").is_file():
            return p
    # Sibling: <repo>/hermes-webui-studio next to <repo>/tools/
    here = Path(__file__).resolve()
    for base in (here.parent.parent, here.parent.parent.parent):
        candidate = base / "hermes-webui-studio"
        if (candidate / "api" / "employee_scripts.py").is_file():
            return candidate.resolve()
    return None


_WEBUI_ROOT = _locate_webui_root()
_execute_script: Optional[Callable[..., dict]] = None
_list_scripts: Optional[Callable[..., list]] = None


def _lazy_import_webui():
    """Import execute_script / list_scripts from webui-studio lazily.

    We do this lazily (instead of at module import time) because the webui
    module touches api.config which may try to read env/files that are only
    present on the webui side. A failed import should never break the agent.
    """
    global _execute_script, _list_scripts
    if _execute_script is not None:
        return True
    if _WEBUI_ROOT is None:
        return False
    try:
        if str(_WEBUI_ROOT) not in sys.path:
            sys.path.insert(0, str(_WEBUI_ROOT))
        # Use importlib to avoid stepping on any existing `api` module
        mod = importlib.import_module("api.employee_scripts")
        _execute_script = getattr(mod, "execute_script", None)
        _list_scripts = getattr(mod, "list_scripts", None)
        return _execute_script is not None
    except Exception as exc:
        logger.debug("employee_script_tool: webui import failed: %s", exc)
        return False


# ── Registry integration ────────────────────────────────────────────────────

def _handler(args: dict, **kw) -> str:
    """Tool entrypoint — called by tools/registry's dispatcher."""
    try:
        from tools.registry import tool_error
    except Exception:
        def tool_error(msg):
            return json.dumps({"success": False, "error": msg})

    scope = (args.get("scope") or "employee").strip().lower()
    if scope not in ("employee", "workspace", "preset"):
        return tool_error("scope must be one of: employee | workspace | preset")

    script_name = (args.get("script_name") or "").strip()
    if not script_name:
        return tool_error("script_name is required")

    script_args = args.get("args") or {}
    if not isinstance(script_args, dict):
        return tool_error("args must be an object (dict)")

    timeout = int(args.get("timeout") or _DEFAULT_TIMEOUT)
    timeout = max(1, min(timeout, _MAX_TIMEOUT))

    # Context (injected by the platform, or explicitly passed in args for CLI)
    emp_id = kw.get("emp_id") or args.get("emp_id") or ""
    workspace = kw.get("workspace") or args.get("workspace") or ""
    scope_id = args.get("scope_id") or workspace

    # Preset scope uses args.scope_id = preset id (e.g. "pm-specialist")
    if scope == "preset" and not scope_id:
        return tool_error("scope_id (preset id) is required when scope=preset")

    if not _lazy_import_webui():
        return tool_error(
            "employee_scripts runtime not available — this tool requires "
            "hermes-webui-studio to be installed alongside hermes-agent. "
            "Set HERMES_WEBUI_ROOT env var to the webui directory."
        )

    try:
        result = _execute_script(
            scope=scope,
            scope_id=scope_id,
            script_name=script_name,
            args=script_args,
            timeout=timeout,
            emp_id=emp_id,
            workspace=workspace,
        )
    except Exception as exc:
        logger.exception("run_employee_script failed")
        return tool_error(f"execution error: {exc}")

    return json.dumps(result, ensure_ascii=False)


def _register():
    try:
        from tools.registry import registry
    except Exception as exc:
        logger.debug("employee_script_tool: cannot import registry (%s)", exc)
        return

    schema = {
        "name": "run_employee_script",
        "description": (
            "Execute a Python script from the employee/workspace/preset "
            "`scripts/` directory. Scripts receive their arguments via stdin "
            "as JSON (the script reads with `sys.stdin.read()` and parses). "
            "Returns a dict with {success, exit_code, stdout, stderr, "
            "duration_ms}. Use this instead of `execute_code` when a "
            "reusable script already exists for the task — it is faster, "
            "tested, and sandboxable. Typical scripts: "
            "generate_sprint_plan.py, workspace_health_check.py, "
            "task_decompose_helper.py (for PM specialist). "
            "List available scripts via list_scripts helper or check the "
            "role preset's scripts/ directory."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "scope": {
                    "type": "string",
                    "enum": ["employee", "workspace", "preset"],
                    "description": (
                        "Where to look for the script: "
                        "'employee' = your own scripts/ folder, "
                        "'workspace' = shared workspace scripts/, "
                        "'preset' = built-in role preset examples (read-only)."
                    ),
                },
                "script_name": {
                    "type": "string",
                    "description": (
                        "Script filename (e.g. 'generate_sprint_plan.py'). "
                        "Must end with .py and must exist in the scripts/ dir."
                    ),
                },
                "args": {
                    "type": "object",
                    "description": (
                        "Arguments passed to the script via stdin as a JSON "
                        "object. Optional — defaults to {}."
                    ),
                },
                "timeout": {
                    "type": "integer",
                    "description": (
                        f"Execution timeout in seconds (default "
                        f"{_DEFAULT_TIMEOUT}, max {_MAX_TIMEOUT})."
                    ),
                },
                "scope_id": {
                    "type": "string",
                    "description": (
                        "Required when scope='preset' — the preset id "
                        "(e.g. 'pm-specialist'). For other scopes this is "
                        "auto-injected from the session context."
                    ),
                },
            },
            "required": ["scope", "script_name"],
        },
    }

    registry.register(
        name="run_employee_script",
        toolset="employee_scripts",
        schema=schema,
        handler=_handler,
        description="Execute a script from a scripts/ directory (employee/workspace/preset).",
    )


# Side-effect at import: register with the tools registry if available.
try:
    _register()
except Exception as _exc:
    logger.debug("employee_script_tool: registration failed: %s", _exc)
