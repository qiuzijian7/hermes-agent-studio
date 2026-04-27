#!/usr/bin/env python3
"""
Group Message Tool -- Send messages to the workspace group chat (总群).

Allows employee agents running inside the WebUI to post messages to the
group chat, enabling inter-employee communication visible to the user.

This tool works by calling the WebUI's HTTP API directly from the agent's
Python process. It requires the HERMES_SESSION_KEY environment variable
(which is set by the WebUI streaming engine) to locate the correct workspace.
"""

import json
import logging
import os
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)


def _get_webui_base_url() -> str:
    """Get the WebUI base URL from environment or default."""
    return os.getenv("HERMES_WEBUI_URL", "http://127.0.0.1:18080")


def _get_workspace_from_env() -> str:
    """Resolve the workspace path from environment variables."""
    candidates = [
        os.getenv("TERMINAL_CWD"),
        os.getenv("HERMES_WORKSPACE"),
    ]
    for c in candidates:
        if c and c.strip():
            return c.strip()
    return ""


def send_group_message(
    message: str,
    mentions: list = None,
) -> str:
    """Send a message to the workspace group chat (总群).

    The message will appear in the group chat panel with the employee's
    name as the sender. Other employees can see it and respond.

    Args:
        message: The message text to send. Can include @mentions to
                 delegate tasks to other employees (e.g. "@设计师 请设计首页布局").
        mentions: Optional list of employee names to explicitly mention.
                  If not provided, @mentions are auto-parsed from the message text.

    Returns:
        JSON string with success status.
    """
    if not message or not message.strip():
        return json.dumps({"error": "message is required"})

    workspace = _get_workspace_from_env()
    if not workspace:
        return json.dumps({"error": "No workspace context available. This tool only works inside the WebUI."})

    base_url = _get_webui_base_url()

    # ★ 直接添加消息到总群（不走 /api/group-chat/send），
    #   避免后端重复解析 @mentions 和生成系统消息。
    #   前端 SSE 监听到 send_group_message 工具调用后，
    #   会自行解析 @mentions 并执行委派（_dispatchTaskToEmployee），
    #   _dispatchTaskToEmployee 内部会调用 /api/group-chat/send 来
    #   生成正确的系统消息和 task_id。
    url = f"{base_url}/api/group-chat/message"

    payload = {
        "workspace": workspace,
        "message": message.strip(),
        "sender_name": os.getenv("HERMES_EMPLOYEE_NAME", ""),
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok"):
                result = {
                    "ok": True,
                    "message": "Message sent to group chat",
                }
                # ★ 解析 @mentions 并返回给 agent
                from api.group_chat import parse_mentions
                mentioned_names = parse_mentions(message)
                if mentioned_names:
                    result["mentions"] = mentioned_names
                    result["delegated_to"] = ", ".join(mentioned_names)
                    result["hint"] = "Tasks will be dispatched to the mentioned employees. Their results will appear in the group chat when they complete."
                return json.dumps(result, ensure_ascii=False)
            else:
                return json.dumps({
                    "error": data.get("error", data.get("message", "Unknown error")),
                })
    except urllib.error.URLError as e:
        return json.dumps({
            "error": f"Cannot reach WebUI at {base_url}: {e.reason}. This tool only works inside the WebUI group chat context.",
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


def _check_requirements() -> bool:
    """Check if the group message tool is available.

    Only available when running inside the WebUI (has HERMES_SESSION_KEY
    or TERMINAL_CWD set by the streaming engine).
    """
    return bool(os.getenv("HERMES_SESSION_KEY") or os.getenv("TERMINAL_CWD"))


# ── OpenAI Function-Calling Schema ────────────────────────────────────────────

SEND_GROUP_MESSAGE_SCHEMA = {
    "name": "send_group_message",
    "description": (
        "Send a message to the workspace group chat (总群). "
        "The message is visible to all team members and the user. "
        "Use this to:\n"
        "- Report progress or intermediate results to the team\n"
        "- Ask questions to other employees by @mentioning them\n"
        "- Delegate subtasks to other employees by @mentioning them "
        "(e.g. '@设计师 请设计首页布局')\n"
        "- Coordinate work with other team members\n\n"
        "When you @mention another employee, a task is automatically "
        "dispatched to them. Their result will appear in the group chat "
        "when they complete.\n\n"
        "This tool only works inside the WebUI group chat context."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "message": {
                "type": "string",
                "description": (
                    "Message text to send to the group chat. "
                    "You can @mention other employees to delegate tasks "
                    "(e.g. '@设计师 请设计首页布局' delegates a task to '设计师'). "
                    "Be clear and specific in your messages."
                ),
            },
        },
        "required": ["message"],
    },
}


# ── Registry ─────────────────────────────────────────────────────────────────

from tools.registry import registry

registry.register(
    name="send_group_message",
    toolset="delegation",
    schema=SEND_GROUP_MESSAGE_SCHEMA,
    handler=lambda args, **kw: send_group_message(
        message=args.get("message", ""),
        mentions=args.get("mentions"),
    ),
    check_fn=_check_requirements,
    emoji="💬",
)
