#!/usr/bin/env python3
"""
Agent Runner -- OpenClaw-style async multi-agent orchestration.

Unlike delegate_task (synchronous blocking), spawn_agent creates child agents
that run in background threads. The parent continues processing and receives
results via an announce queue when children complete.

Key features (inspired by OpenClaw):
  - spawn_agent: async spawn, returns immediately with a session_id
  - steer_agent: send guidance messages to running child agents
  - list_agents: query status of active children
  - announce mechanism: child results injected as user messages into parent
  - timeout_seconds: time-based termination (not just iteration limits)
  - configurable concurrency and depth limits

Architecture:
  AgentRunner is attached to each AIAgent instance. It manages the lifecycle
  of spawned child agents, their communication channels, and result delivery.
"""

import json
import logging
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from toolsets import TOOLSETS

logger = logging.getLogger(__name__)


def _get_workspace_from_parent(parent_agent) -> str:
    """从 parent agent 上下文里抽取 workspace 路径（供 event payload 使用）。

    WebUI 模式下，streaming 会在 parent agent 上设置 workspace/TERMINAL_CWD；
    CLI/gateway 模式下可能缺失，此时返回空串——event_bus hook 应自行判空跳过。
    """
    try:
        import os
        for attr in ("workspace", "_workspace", "cwd"):
            v = getattr(parent_agent, attr, None)
            if v and isinstance(v, str) and v.strip():
                return v.strip()
        # 兜底：环境变量（streaming 会设置）
        v = os.getenv("TERMINAL_CWD") or os.getenv("HERMES_WORKSPACE")
        return (v or "").strip()
    except Exception:
        return ""


# ── Constants ──────────────────────────────────────────────────────────────

DEFAULT_MAX_CONCURRENT = 8        # OpenClaw default is 8
DEFAULT_MAX_CHILDREN_PER_AGENT = 5  # OpenClaw default is 5
DEFAULT_TIMEOUT_SECONDS = 300     # 5 minutes
DEFAULT_MAX_ITERATIONS = 50
STEER_RATE_LIMIT_SECONDS = 2     # Min interval between steer messages
STEER_MAX_LENGTH = 4000          # Max characters per steer message

# Tools that async children must never have access to
ASYNC_CHILD_BLOCKED_TOOLS = frozenset([
    "delegate_task",   # use spawn_agent instead for async
    "clarify",         # no user interaction
    "memory",          # no writes to shared MEMORY.md
    "send_message",    # no cross-platform side effects
    "execute_code",    # children should reason step-by-step
])
# Note: send_group_message is NOT blocked — child agents can report progress
# back to the group chat, enabling inter-employee communication.
# Note: spawn_agent is NOT blocked — orchestrator-role children can spawn
# their own children (up to depth limit). Leaf-role children are blocked
# at runtime by the depth check in AgentRunner.spawn().

# Agent roles (OpenClaw-style)
class AgentRole(str, Enum):
    MAIN = "main"              # Top-level agent
    ORCHESTRATOR = "orchestrator"  # Can spawn children
    LEAF = "leaf"              # Cannot spawn children


class AgentStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    INTERRUPTED = "interrupted"
    STEERED = "steered"        # Received a steer message, processing


@dataclass
class ChildAgentEntry:
    """Tracks a spawned child agent's lifecycle."""
    session_id: str
    goal: str
    role: AgentRole = AgentRole.LEAF
    status: AgentStatus = AgentStatus.PENDING
    child_agent: Any = None          # AIAgent instance
    thread: Optional[threading.Thread] = None
    start_time: float = 0.0
    end_time: float = 0.0
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    result_summary: Optional[str] = None
    result_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    label: str = ""
    employee_name: Optional[str] = None
    employee_role: Optional[str] = None
    # Steer state
    _steer_queue: queue.Queue = field(default_factory=queue.Queue)
    _last_steer_time: float = 0.0
    _steer_count: int = 0


class AgentRunner:
    """Manages async child agents for an AIAgent instance.

    Attached to parent_agent._agent_runner at initialization.
    Thread-safe: all state mutations go through _lock.
    """

    # 进程内全局注册表：parent_session_id -> AgentRunner
    # 由 HTTP 端点（api/agents.py）通过 session_id 查到对应 runner 后转发 steer/cancel 调用。
    _GLOBAL_REGISTRY: Dict[str, "AgentRunner"] = {}
    _GLOBAL_REGISTRY_LOCK = threading.RLock()

    def __init__(self, parent_agent):
        self.parent = parent_agent
        self._children: Dict[str, ChildAgentEntry] = {}
        self._lock = threading.Lock()
        self._announce_queue: queue.Queue = queue.Queue()
        self._completed_count = 0
        self._max_concurrent = self._get_max_concurrent()
        self._max_depth = 2  # Same as delegate_task
        # 注册到全局表（幂等：以 parent.session_id 为 key）
        sid = getattr(parent_agent, "session_id", None)
        if sid:
            with AgentRunner._GLOBAL_REGISTRY_LOCK:
                AgentRunner._GLOBAL_REGISTRY[sid] = self

    @classmethod
    def lookup(cls, parent_session_id: str) -> "Optional[AgentRunner]":
        """通过 parent session_id 找到活跃的 AgentRunner。HTTP 端点使用。"""
        if not parent_session_id:
            return None
        with cls._GLOBAL_REGISTRY_LOCK:
            return cls._GLOBAL_REGISTRY.get(parent_session_id)

    @classmethod
    def unregister(cls, parent_session_id: str) -> None:
        """从全局表移除（parent agent 析构时调用）。"""
        if not parent_session_id:
            return
        with cls._GLOBAL_REGISTRY_LOCK:
            cls._GLOBAL_REGISTRY.pop(parent_session_id, None)


    def _get_max_concurrent(self) -> int:
        """Read delegation.max_concurrent_children from config."""
        try:
            from delegate_tool import _load_config
            cfg = _load_config()
            val = cfg.get("max_concurrent_children")
            if val is not None:
                return max(1, int(val))
        except Exception:
            pass
        return DEFAULT_MAX_CONCURRENT

    def _get_max_children_per_agent(self) -> int:
        """Read delegation.max_children_per_agent from config."""
        try:
            from delegate_tool import _load_config
            cfg = _load_config()
            val = cfg.get("max_children_per_agent")
            if val is not None:
                return max(1, int(val))
        except Exception:
            pass
        return DEFAULT_MAX_CHILDREN_PER_AGENT

    # ── Spawn ──────────────────────────────────────────────────────────────

    def spawn(
        self,
        goal: str,
        context: Optional[str] = None,
        label: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        toolsets: Optional[List[str]] = None,
        employee_name: Optional[str] = None,
        employee_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Spawn a child agent that runs asynchronously in a background thread.

        Returns immediately with the child's session_id.
        The child's result will be delivered via announce when it completes.
        """
        # Depth check
        depth = getattr(self.parent, '_delegate_depth', 0)
        if depth >= self._max_depth:
            return {
                "error": f"Delegation depth limit reached ({self._max_depth}). "
                         "Cannot spawn more agents at this depth.",
            }

        # Concurrency check
        with self._lock:
            active_count = sum(
                1 for c in self._children.values()
                if c.status in (AgentStatus.PENDING, AgentStatus.RUNNING, AgentStatus.STEERED)
            )
            if active_count >= self._get_max_children_per_agent():
                return {
                    "error": f"Max active children reached ({self._get_max_children_per_agent()}). "
                             "Wait for some children to complete before spawning more.",
                }

        # Build the child agent
        session_id = f"spawn-{uuid.uuid4().hex[:8]}"
        effective_timeout = timeout_seconds or DEFAULT_TIMEOUT_SECONDS
        effective_label = label or goal[:40]

        try:
            child = self._build_child(
                session_id=session_id,
                goal=goal,
                context=context,
                toolsets=toolsets,
                employee_name=employee_name,
                employee_role=employee_role,
            )
        except Exception as exc:
            logger.exception("Failed to build child agent for spawn")
            return {"error": f"Failed to create child agent: {exc}"}

        entry = ChildAgentEntry(
            session_id=session_id,
            goal=goal,
            role=AgentRole.ORCHESTRATOR if depth < self._max_depth - 1 else AgentRole.LEAF,
            status=AgentStatus.PENDING,
            child_agent=child,
            timeout_seconds=effective_timeout,
            label=effective_label,
            employee_name=employee_name,
            employee_role=employee_role,
        )

        with self._lock:
            self._children[session_id] = entry

        # Start child in background thread
        thread = threading.Thread(
            target=self._run_child,
            args=(session_id,),
            daemon=True,
            name=f"agent-{session_id}",
        )
        entry.thread = thread
        thread.start()

        # 发射 subagent.spawn 事件（graceful import，event_bus 仅在 webui 项目存在时可用）
        try:
            from api.event_bus import emit as _emit
            _emit("subagent.spawn", {
                "parent_id": getattr(self.parent, "session_id", None),
                "child_session_id": session_id,
                "goal": goal[:400],
                "label": effective_label,
                "role": entry.role.value,
                "timeout_seconds": effective_timeout,
                "employee_name": employee_name,
                "employee_role": employee_role,
                "workspace": _get_workspace_from_parent(self.parent),
            })
        except Exception:
            pass  # event_bus 不可用时静默

        return {
            "session_id": session_id,
            "status": "spawned",
            "label": effective_label,
            "role": entry.role.value,
            "timeout_seconds": effective_timeout,
            "message": f"Child agent spawned. It will announce its result when complete. "
                       f"Use steer_agent(session_id='{session_id}', message='...') to guide it.",
        }

    # ── Steer ──────────────────────────────────────────────────────────────

    def steer(self, session_id: str, message: str) -> Dict[str, Any]:
        """Send a guidance message to a running child agent.

        Rate-limited: max 1 steer per 2 seconds.
        Message max length: 4000 characters.
        """
        with self._lock:
            entry = self._children.get(session_id)

        if not entry:
            return {"error": f"No child agent found with session_id '{session_id}'"}

        if entry.status not in (AgentStatus.RUNNING, AgentStatus.STEERED):
            return {"error": f"Child agent is not running (status: {entry.status.value})"}

        # Rate limit
        now = time.monotonic()
        if now - entry._last_steer_time < STEER_RATE_LIMIT_SECONDS:
            remaining = round(STEER_RATE_LIMIT_SECONDS - (now - entry._last_steer_time), 1)
            return {"error": f"Rate limited: wait {remaining}s before next steer"}

        # Length limit
        if len(message) > STEER_MAX_LENGTH:
            message = message[:STEER_MAX_LENGTH]

        # Inject steer message into child's queue
        entry._steer_queue.put(message)
        entry._last_steer_time = now
        entry._steer_count += 1

        return {
            "status": "steered",
            "session_id": session_id,
            "steer_count": entry._steer_count,
        }

    # ── List ───────────────────────────────────────────────────────────────

    def list_children(self) -> List[Dict[str, Any]]:
        """List all spawned children and their status."""
        with self._lock:
            result = []
            for sid, entry in self._children.items():
                elapsed = 0.0
                if entry.start_time:
                    end = entry.end_time or time.monotonic()
                    elapsed = round(end - entry.start_time, 1)

                result.append({
                    "session_id": sid,
                    "label": entry.label,
                    "role": entry.role.value,
                    "status": entry.status.value,
                    "elapsed_seconds": elapsed,
                    "goal": entry.goal[:100],
                    "employee_name": entry.employee_name,
                    "steer_count": entry._steer_count,
                })
            return result

    # ── Announce Poll ──────────────────────────────────────────────────────

    def poll_announces(self, max_items: int = 5) -> List[Dict[str, Any]]:
        """Poll for completed child announcements.

        Called by run_agent.py's agent loop to inject child results
        as user messages into the parent's conversation.
        """
        results = []
        while len(results) < max_items:
            try:
                item = self._announce_queue.get_nowait()
                results.append(item)
            except queue.Empty:
                break
        return results

    def has_pending_announces(self) -> bool:
        """Check if there are any announce messages waiting."""
        return not self._announce_queue.empty()

    # ── Internal: Build & Run ──────────────────────────────────────────────

    def _build_child(
        self,
        session_id: str,
        goal: str,
        context: Optional[str],
        toolsets: Optional[List[str]],
        employee_name: Optional[str],
        employee_role: Optional[str],
    ):
        """Build a child AIAgent for async execution."""
        from run_agent import AIAgent
        from delegate_tool import (
            _build_child_system_prompt,
            _resolve_workspace_hint,
            _strip_blocked_tools,
            _resolve_delegation_credentials,
            _load_config,
            _resolve_child_credential_pool,
            DEFAULT_MAX_ITERATIONS,
        )

        # Resolve credentials
        cfg = _load_config()
        try:
            creds = _resolve_delegation_credentials(cfg, self.parent)
        except ValueError as exc:
            raise ValueError(str(exc))

        # Resolve toolsets
        parent_enabled = getattr(self.parent, "enabled_toolsets", None)
        if parent_enabled is not None:
            parent_toolsets = set(parent_enabled)
        elif self.parent and hasattr(self.parent, "valid_tool_names"):
            import model_tools
            parent_toolsets = {
                ts for name in self.parent.valid_tool_names
                if (ts := model_tools.get_toolset_for_tool(name)) is not None
            }
        else:
            parent_toolsets = {"terminal", "file", "web"}

        if toolsets:
            child_toolsets = _strip_blocked_tools([t for t in toolsets if t in parent_toolsets])
        else:
            child_toolsets = _strip_blocked_tools(sorted(parent_toolsets))

        workspace_hint = _resolve_workspace_hint(self.parent)
        max_iterations = cfg.get("max_iterations", DEFAULT_MAX_ITERATIONS)

        child_prompt = _build_child_system_prompt(
            goal, context, workspace_path=workspace_hint,
            employee_name=employee_name, employee_role=employee_role,
        )

        # Add async-specific guidance to the prompt
        child_prompt += (
            "\n\nIMPORTANT: You are running as an async subagent. "
            "Your parent agent may send you guidance messages during execution. "
            "When you receive a guidance message, consider it and adjust your approach accordingly. "
            "Focus on producing a clear, actionable summary when done."
        )

        # Resolve credentials
        parent_api_key = getattr(self.parent, "api_key", None)
        if (not parent_api_key) and hasattr(self.parent, "_client_kwargs"):
            parent_api_key = self.parent._client_kwargs.get("api_key")

        effective_model = creds["model"] or self.parent.model
        effective_provider = creds["provider"] or getattr(self.parent, "provider", None)
        effective_base_url = creds["base_url"] or self.parent.base_url
        effective_api_key = creds["api_key"] or parent_api_key
        effective_api_mode = creds["api_mode"] or getattr(self.parent, "api_mode", None)

        child = AIAgent(
            base_url=effective_base_url,
            api_key=effective_api_key,
            model=effective_model,
            provider=effective_provider,
            api_mode=effective_api_mode,
            max_iterations=max_iterations,
            max_tokens=getattr(self.parent, "max_tokens", None),
            enabled_toolsets=child_toolsets,
            quiet_mode=True,
            ephemeral_system_prompt=child_prompt,
            log_prefix=f"[async-{session_id}]",
            platform=self.parent.platform,
            skip_context_files=True,
            skip_memory=True,
            clarify_callback=None,
            session_db=getattr(self.parent, '_session_db', None),
            parent_session_id=getattr(self.parent, 'session_id', None),
            providers_allowed=self.parent.providers_allowed,
            providers_ignored=self.parent.providers_ignored,
            providers_order=self.parent.providers_order,
            provider_sort=getattr(self.parent, 'provider_sort', None),
            iteration_budget=None,
        )

        child._print_fn = getattr(self.parent, '_print_fn', None)
        child._delegate_depth = getattr(self.parent, '_delegate_depth', 0) + 1

        # Share credential pool
        child_pool = _resolve_child_credential_pool(effective_provider, self.parent)
        if child_pool is not None:
            child._credential_pool = child_pool

        # Register for interrupt propagation
        if hasattr(self.parent, '_active_children'):
            lock = getattr(self.parent, '_active_children_lock', None)
            if lock:
                with lock:
                    self.parent._active_children.append(child)
            else:
                self.parent._active_children.append(child)

        return child

    def _run_child(self, session_id: str):
        """Run a child agent in a background thread. Handles timeout and steer."""
        with self._lock:
            entry = self._children.get(session_id)
        if not entry or not entry.child_agent:
            return

        child = entry.child_agent
        entry.status = AgentStatus.RUNNING
        entry.start_time = time.monotonic()

        # Save parent tool names before child mutates the global
        import model_tools as _model_tools
        _parent_tool_names = list(_model_tools._last_resolved_tool_names)

        # Lease credential
        child_pool = getattr(child, '_credential_pool', None)
        leased_cred_id = None
        if child_pool is not None:
            leased_cred_id = child_pool.acquire_lease()
            if leased_cred_id is not None:
                try:
                    leased_entry = child_pool.current()
                    if leased_entry is not None and hasattr(child, '_swap_credential'):
                        child._swap_credential(leased_entry)
                except Exception as exc:
                    logger.debug("Failed to bind child to leased credential: %s", exc)

        # Heartbeat thread
        _heartbeat_stop = threading.Event()

        def _heartbeat_loop():
            while not _heartbeat_stop.wait(30):
                touch = getattr(self.parent, '_touch_activity', None)
                if touch:
                    try:
                        touch(f"spawn_agent: child {session_id} working")
                    except Exception:
                        pass

        _heartbeat_thread = threading.Thread(target=_heartbeat_loop, daemon=True)
        _heartbeat_thread.start()

        # Timeout monitoring thread
        _timeout_stop = threading.Event()

        def _timeout_monitor():
            while not _timeout_stop.wait(5):
                elapsed = time.monotonic() - entry.start_time
                if elapsed >= entry.timeout_seconds:
                    logger.info("Child agent %s timed out after %.0fs", session_id, elapsed)
                    try:
                        child.interrupt("Timeout: execution exceeded time limit")
                    except Exception:
                        pass
                    return

        _timeout_thread = threading.Thread(target=_timeout_monitor, daemon=True)
        _timeout_thread.start()

        # Steer injection thread — monitors steer queue and injects messages
        # into the child's conversation as user messages
        _steer_stop = threading.Event()

        def _steer_monitor():
            while not _steer_stop.wait(0.5):
                try:
                    msg = entry._steer_queue.get_nowait()
                except queue.Empty:
                    continue

                # Inject steer message as a user message into the child's
                # conversation. The child's run_conversation loop will pick it up.
                # We do this by appending to the child's message list directly.
                try:
                    steer_content = (
                        f"[PARENT GUIDANCE]\n{msg}\n[/PARENT GUIDANCE]\n\n"
                        "Consider this guidance and adjust your approach if needed. "
                        "Continue working on your task."
                    )
                    # The child agent's messages are accessible via its internal state
                    # We set a flag that the agent loop checks
                    child._steer_message = steer_content
                    entry.status = AgentStatus.STEERED
                    logger.info("Steered child %s (steer #%d)", session_id, entry._steer_count)
                except Exception as exc:
                    logger.debug("Failed to inject steer message: %s", exc)

        _steer_thread = threading.Thread(target=_steer_monitor, daemon=True)
        _steer_thread.start()

        try:
            # Run the child agent
            result = child.run_conversation(user_message=entry.goal)

            duration = round(time.monotonic() - entry.start_time, 2)
            summary = result.get("final_response") or ""
            completed = result.get("completed", False)
            interrupted = result.get("interrupted", False)

            if interrupted:
                # Check if it was a timeout
                if time.monotonic() - entry.start_time >= entry.timeout_seconds - 5:
                    entry.status = AgentStatus.TIMED_OUT
                else:
                    entry.status = AgentStatus.INTERRUPTED
            elif summary:
                entry.status = AgentStatus.COMPLETED
            else:
                entry.status = AgentStatus.FAILED

            entry.end_time = time.monotonic()
            entry.result_summary = summary
            entry.result_data = {
                "session_id": session_id,
                "status": entry.status.value,
                "summary": summary,
                "duration_seconds": duration,
                "api_calls": result.get("api_calls", 0),
                "model": getattr(child, "model", None),
                "tokens": {
                    "input": getattr(child, "session_prompt_tokens", 0),
                    "output": getattr(child, "session_completion_tokens", 0),
                },
            }
            if entry.status == AgentStatus.FAILED:
                entry.result_data["error"] = result.get("error", "No response produced")

            # Inject delegation trace into employee session if applicable
            if entry.employee_name and summary and self.parent:
                try:
                    from delegate_tool import _inject_delegation_to_employee_session
                    _inject_delegation_to_employee_session(
                        self.parent, entry.employee_name, session_id,
                        entry.goal, summary, entry.status.value,
                    )
                except Exception as e:
                    logger.debug("Failed to inject delegation trace: %s", e)

            # Queue announce message for parent
            self._announce_queue.put({
                "type": "announce",
                "session_id": session_id,
                "label": entry.label,
                "status": entry.status.value,
                "summary": summary,
                "duration_seconds": duration,
                "employee_name": entry.employee_name,
                "steer_count": entry._steer_count,
            })

            # 发射 subagent.announce 事件（用于 hooks/group_chat_echo 等）
            self._emit_announce_event(entry, duration, summary, error=None)

            self._completed_count += 1

        except Exception as exc:
            duration = round(time.monotonic() - entry.start_time, 2)
            entry.status = AgentStatus.FAILED
            entry.end_time = time.monotonic()
            entry.error = str(exc)
            entry.result_data = {
                "session_id": session_id,
                "status": "error",
                "error": str(exc),
                "duration_seconds": duration,
            }
            self._announce_queue.put({
                "type": "announce",
                "session_id": session_id,
                "label": entry.label,
                "status": "error",
                "summary": f"Child agent failed: {exc}",
                "duration_seconds": duration,
            })
            # 发射 subagent.announce 事件（失败分支）
            self._emit_announce_event(entry, duration, f"Child agent failed: {exc}", error=str(exc))

        finally:
            # Cleanup
            _heartbeat_stop.set()
            _timeout_stop.set()
            _steer_stop.set()
            _heartbeat_thread.join(timeout=3)
            _timeout_thread.join(timeout=3)
            _steer_thread.join(timeout=3)

            # Release credential
            if child_pool is not None and leased_cred_id is not None:
                try:
                    child_pool.release_lease(leased_cred_id)
                except Exception:
                    pass

            # Restore parent tool names
            if isinstance(_parent_tool_names, list):
                _model_tools._last_resolved_tool_names = list(_parent_tool_names)

            # Remove from interrupt propagation
            if hasattr(self.parent, '_active_children'):
                try:
                    lock = getattr(self.parent, '_active_children_lock', None)
                    if lock:
                        with lock:
                            self.parent._active_children.remove(child)
                    else:
                        self.parent._active_children.remove(child)
                except (ValueError, UnboundLocalError):
                    pass

            # Close child resources
            try:
                if hasattr(child, 'close'):
                    child.close()
            except Exception:
                pass

    # ── Cleanup ────────────────────────────────────────────────────────────

    def _emit_announce_event(
        self, entry: "ChildAgentEntry", duration: float,
        summary: str, error: Optional[str] = None,
    ) -> None:
        """Emit ``subagent.announce`` via event_bus (graceful no-op if unavailable)."""
        try:
            from api.event_bus import emit as _emit
        except Exception:
            return
        payload = {
            "parent_id": getattr(self.parent, "session_id", None),
            "child_session_id": entry.session_id,
            "label": entry.label,
            "status": entry.status.value,
            "summary": summary or "",
            "duration_seconds": duration,
            "steer_count": entry._steer_count,
            "child_employee_name": entry.employee_name,
            "child_employee_role": entry.employee_role,
            "workspace": _get_workspace_from_parent(self.parent),
        }
        if error:
            payload["error"] = error
        try:
            _emit("subagent.announce", payload)
        except Exception as e:
            logger.debug("event_bus emit failed: %s", e)

    def cancel(self, session_id: str) -> Dict[str, Any]:
        """Cancel a running child agent."""
        with self._lock:
            entry = self._children.get(session_id)
        if not entry:
            return {"error": f"No child agent found with session_id '{session_id}'"}
        if entry.status not in (AgentStatus.RUNNING, AgentStatus.STEERED):
            return {"error": f"Child agent is not running (status: {entry.status.value})"}
        try:
            entry.child_agent.interrupt("Cancelled by parent agent")
            return {"status": "cancelling", "session_id": session_id}
        except Exception as exc:
            return {"error": f"Failed to cancel: {exc}"}

    def close_all(self):
        """Cancel all running children. Called on parent shutdown."""
        with self._lock:
            entries = list(self._children.values())
        for entry in entries:
            if entry.status in (AgentStatus.RUNNING, AgentStatus.STEERED, AgentStatus.PENDING):
                try:
                    if entry.child_agent:
                        entry.child_agent.interrupt("Parent shutting down")
                except Exception:
                    pass


# ── Tool Schemas & Registration ────────────────────────────────────────────

SPAWN_AGENT_SCHEMA = {
    "name": "spawn_agent",
    "description": (
        "Spawn a child agent that runs ASYNCHRONOUSLY in the background. "
        "Returns immediately with a session_id — the parent does NOT block. "
        "When the child completes, its result is automatically announced to you "
        "as a user message in your conversation.\n\n"
        "DIFFERENCE FROM delegate_task:\n"
        "- delegate_task: BLOCKS until all children complete (synchronous)\n"
        "- spawn_agent: Returns immediately, child runs in background (async)\n\n"
        "Use spawn_agent when:\n"
        "- You need to continue working while children run\n"
        "- You want to steer/guide children during execution\n"
        "- You need timeout control (not just iteration limits)\n"
        "- You're managing multiple long-running tasks\n\n"
        "Use steer_agent(session_id, message) to send guidance to running children.\n"
        "Use list_agents() to check status of all spawned children.\n\n"
        "IMPORTANT:\n"
        "- Children cannot call delegate_task or spawn_agent (depth limit: 2)\n"
        "- Children cannot interact with the user (no clarify tool)\n"
        "- Each child gets its own terminal session and isolated context\n"
        "- Results arrive as announce messages in your conversation"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "goal": {
                "type": "string",
                "description": "What the child agent should accomplish. Be specific and self-contained.",
            },
            "context": {
                "type": "string",
                "description": "Background information the child needs: file paths, constraints, etc.",
            },
            "label": {
                "type": "string",
                "description": "Short label for this child (shown in status displays). Default: first 40 chars of goal.",
            },
            "timeout_seconds": {
                "type": "number",
                "description": "Maximum execution time in seconds (default: 300). Child is interrupted if it exceeds this.",
            },
            "toolsets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Toolsets to enable for this child. Default: inherits parent's toolsets.",
            },
            "employee_name": {
                "type": "string",
                "description": "Name of the employee this child represents (for WebUI traceability).",
            },
            "employee_role": {
                "type": "string",
                "description": "Role/specialty of the employee.",
            },
        },
        "required": ["goal"],
    },
}

STEER_AGENT_SCHEMA = {
    "name": "steer_agent",
    "description": (
        "Send a guidance message to a running child agent spawned by spawn_agent. "
        "The child will receive the message and adjust its approach.\n\n"
        "Rate limited: max 1 message per 2 seconds per child.\n"
        "Max message length: 4000 characters.\n\n"
        "Use this to:\n"
        "- Redirect a child that's going off-track\n"
        "- Provide additional context discovered after spawning\n"
        "- Ask the child to focus on a specific aspect\n"
        "- Tell the child to wrap up early"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "The session_id returned by spawn_agent.",
            },
            "message": {
                "type": "string",
                "description": "Guidance message for the child agent.",
            },
        },
        "required": ["session_id", "message"],
    },
}

LIST_AGENTS_SCHEMA = {
    "name": "list_agents",
    "description": (
        "List all child agents spawned by spawn_agent with their current status. "
        "Use this to check progress of async children before they announce their results."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
    },
}


# ── Tool Handlers ──────────────────────────────────────────────────────────

def _get_runner(parent_agent) -> Optional[AgentRunner]:
    """Get or create the AgentRunner for a parent agent."""
    if parent_agent is None:
        return None
    runner = getattr(parent_agent, '_agent_runner', None)
    if runner is None:
        runner = AgentRunner(parent_agent)
        parent_agent._agent_runner = runner
    return runner


def spawn_agent(goal=None, context=None, label=None, timeout_seconds=None,
                toolsets=None, employee_name=None, employee_role=None,
                parent_agent=None):
    """Tool handler for spawn_agent."""
    if parent_agent is None:
        return json.dumps({"error": "spawn_agent requires a parent agent context."})

    runner = _get_runner(parent_agent)
    if runner is None:
        return json.dumps({"error": "Failed to initialize agent runner."})

    if not goal or not goal.strip():
        return json.dumps({"error": "A 'goal' is required."})

    result = runner.spawn(
        goal=goal.strip(),
        context=context,
        label=label,
        timeout_seconds=timeout_seconds,
        toolsets=toolsets,
        employee_name=employee_name,
        employee_role=employee_role,
    )
    return json.dumps(result, ensure_ascii=False)


def steer_agent(session_id=None, message=None, parent_agent=None):
    """Tool handler for steer_agent."""
    if parent_agent is None:
        return json.dumps({"error": "steer_agent requires a parent agent context."})

    runner = _get_runner(parent_agent)
    if runner is None:
        return json.dumps({"error": "No agent runner available."})

    if not session_id or not message:
        return json.dumps({"error": "Both 'session_id' and 'message' are required."})

    result = runner.steer(session_id, message)
    return json.dumps(result, ensure_ascii=False)


def list_agents(parent_agent=None):
    """Tool handler for list_agents."""
    if parent_agent is None:
        return json.dumps({"error": "list_agents requires a parent agent context."})

    runner = _get_runner(parent_agent)
    if runner is None:
        return json.dumps({"children": []})

    children = runner.list_children()
    return json.dumps({"children": children}, ensure_ascii=False)


# ── Registry ──────────────────────────────────────────────────────────────

from tools.registry import registry


def check_spawn_requirements() -> bool:
    """spawn_agent has no external requirements."""
    return True


registry.register(
    name="spawn_agent",
    toolset="delegation",
    schema=SPAWN_AGENT_SCHEMA,
    handler=lambda args, **kw: spawn_agent(
        goal=args.get("goal"),
        context=args.get("context"),
        label=args.get("label"),
        timeout_seconds=args.get("timeout_seconds"),
        toolsets=args.get("toolsets"),
        employee_name=args.get("employee_name"),
        employee_role=args.get("employee_role"),
        parent_agent=kw.get("parent_agent"),
    ),
    check_fn=check_spawn_requirements,
    emoji="🚀",
)

registry.register(
    name="steer_agent",
    toolset="delegation",
    schema=STEER_AGENT_SCHEMA,
    handler=lambda args, **kw: steer_agent(
        session_id=args.get("session_id"),
        message=args.get("message"),
        parent_agent=kw.get("parent_agent"),
    ),
    check_fn=check_spawn_requirements,
    emoji="📡",
)

registry.register(
    name="list_agents",
    toolset="delegation",
    schema=LIST_AGENTS_SCHEMA,
    handler=lambda args, **kw: list_agents(
        parent_agent=kw.get("parent_agent"),
    ),
    check_fn=check_spawn_requirements,
    emoji="📋",
)
