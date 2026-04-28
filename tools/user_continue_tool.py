#!/usr/bin/env python3
"""
User-Continue Tool — "下一步"暂停机制（P3）

当 agent 在操作浏览器遇到 "需要用户登录 / 需要手动选择 / 需要人工验证" 等场景时，
调用此工具暂停执行；前端显示一个"下一步"按钮，用户完成操作后点击按钮，agent 恢复。

架构（仿 tools/approval.py 的 gateway-notify 模式）：
    webui.streaming._run_agent_streaming(session_id, ...)
        ↓ 注册 notify_cb（用 put SSE 推 'user_continue_required'）
        register_notify(session_id, notify_cb)
    agent 调 request_user_continue("需要登录")
        ↓ 发 notify_cb({cid, reason})  → SSE 推到前端
        ↓ entry.event.wait(timeout)   ← 阻塞
    前端用户点"下一步"
        ↓ POST /api/browser/continue {session_id, action:"continue"}
        ↓ resolve_pending(session_id, "continue")
        ↓ entry.event.set()  ← 解除
    agent 收到 {status:"continued", ...} 继续执行
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from typing import Optional

from tools.registry import registry, tool_error

# ── 内部状态 ────────────────────────────────────────────────────────────────


class _ContinueEntry:
    __slots__ = ("cid", "reason", "started_at", "timeout_at", "event", "result")

    def __init__(self, cid: str, reason: str, timeout_seconds: int):
        self.cid = cid
        self.reason = reason
        self.started_at = time.time()
        self.timeout_at = self.started_at + timeout_seconds
        self.event = threading.Event()
        self.result: Optional[dict] = None  # set by resolve_pending()


_lock = threading.Lock()
# session_id → list[_ContinueEntry]（FIFO；同一个 agent 串行跑，通常只会有一个）
_queues: "dict[str, list[_ContinueEntry]]" = {}
# session_id → notify callback(dict) —— 由 webui 的 streaming 层注册
_notify_cbs: "dict[str, object]" = {}


# ── 对外 API ────────────────────────────────────────────────────────────────


def register_notify(session_key: str, cb) -> None:
    """由 webui (streaming.py) 调用：注册用于推 SSE 事件的回调。

    cb 签名：cb({'continue_id', 'reason', 'timeout_seconds'}) -> None
    """
    with _lock:
        _notify_cbs[session_key] = cb


def unregister_notify(session_key: str) -> None:
    """会话结束时清理；同时解除该 session 所有挂起条目避免 worker 永久阻塞。"""
    with _lock:
        _notify_cbs.pop(session_key, None)
        entries = _queues.pop(session_key, [])
    for e in entries:
        e.result = {"status": "cancelled", "reason": "session_ended",
                    "waited_seconds": int(time.time() - e.started_at)}
        e.event.set()


def resolve_pending(session_key: str, action: str = "continue") -> bool:
    """由 /api/browser/continue 调用：解除 session 最早挂起的 entry。

    action: "continue" | "cancel"
    """
    action = (action or "continue").strip().lower()
    if action not in ("continue", "cancel"):
        action = "continue"
    with _lock:
        q = _queues.get(session_key)
        if not q:
            return False
        entry = q.pop(0)
        if not q:
            _queues.pop(session_key, None)
    entry.result = {
        "status": "continued" if action == "continue" else "cancelled",
        "waited_seconds": int(time.time() - entry.started_at),
    }
    entry.event.set()
    return True


def get_pending(session_key: str) -> Optional[dict]:
    """查询 session 的最早一个未解条目（供前端刷新后恢复显示用）。"""
    with _lock:
        q = _queues.get(session_key)
        if q:
            e = q[0]
            return {
                "continue_id": e.cid,
                "reason": e.reason,
                "started_at": e.started_at,
                "timeout_at": e.timeout_at,
                "timeout_seconds_remaining": max(0, int(e.timeout_at - time.time())),
            }
    return None


# ── Tool 入口 ───────────────────────────────────────────────────────────────


def request_user_continue(reason: str, timeout_seconds: int = 600) -> str:
    """
    暂停执行，提示用户在浏览器中完成手动操作（登录 / 选择 / 验证码），
    完成后点击 UI 上的「下一步」按钮让 agent 继续。

    返回：
        {"status": "continued",  "waited_seconds": N}  ← 用户点"下一步"
        {"status": "cancelled",  "waited_seconds": N}  ← 用户点"取消任务"
        {"status": "timeout",    "waited_seconds": N}  ← 超时
        {"status": "unavailable","reason": "..."}       ← 当前运行环境不支持
    """
    reason = (reason or "").strip() or "需要你的协助，请完成当前步骤后点击「下一步」"
    try:
        timeout_seconds = int(timeout_seconds)
    except Exception:
        timeout_seconds = 600
    timeout_seconds = max(5, min(timeout_seconds, 3600))  # 5s - 1h

    session_key = os.environ.get("HERMES_SESSION_KEY", "").strip()
    if not session_key:
        return json.dumps({
            "status": "unavailable",
            "reason": "此工具仅在 WebUI 环境下可用（当前没有活跃的 session key）。",
        }, ensure_ascii=False)

    # 注册条目
    cid = f"cont_{uuid.uuid4().hex[:10]}"
    entry = _ContinueEntry(cid, reason, timeout_seconds)
    with _lock:
        _queues.setdefault(session_key, []).append(entry)
        notify_cb = _notify_cbs.get(session_key)

    # 通知前端（非必需——没注册也能阻塞；但前端就看不到按钮了）
    if notify_cb is not None:
        try:
            notify_cb({
                "continue_id": cid,
                "reason": reason,
                "timeout_seconds": timeout_seconds,
            })
        except Exception:
            pass

    # 阻塞等待
    got = entry.event.wait(timeout=timeout_seconds)
    if not got:
        # 超时：主动清理
        with _lock:
            q = _queues.get(session_key)
            if q and entry in q:
                q.remove(entry)
                if not q:
                    _queues.pop(session_key, None)
        return json.dumps({
            "status": "timeout",
            "waited_seconds": timeout_seconds,
            "reason": "用户在超时时间内未响应，已自动继续。请根据当前页面状态自行判断下一步。",
        }, ensure_ascii=False)

    return json.dumps(entry.result or {"status": "continued", "waited_seconds": 0},
                      ensure_ascii=False)


def check_user_continue_requirements() -> bool:
    """无外部依赖——始终可用（仅在非 WebUI 环境会返回 unavailable）。"""
    return True


# ── Schema & 注册 ──────────────────────────────────────────────────────────

USER_CONTINUE_SCHEMA = {
    "name": "request_user_continue",
    "description": (
        "暂停执行，要求用户在 WebUI 的浏览器面板中完成一次手动操作（如登录、验证码、2FA、"
        "手动选择下拉项、确认弹窗），完成后用户点击「下一步」按钮让你继续。\n\n"
        "**使用场景**：\n"
        "- 目标网站需要用户登录才能访问后续内容\n"
        "- 出现 CAPTCHA / reCAPTCHA / hCAPTCHA / 极验 / 短信验证码\n"
        "- 网站弹出 Cookie 同意 / 年龄确认 / 地区选择弹窗\n"
        "- 需要用户在两个/多个候选项中做个人选择（如选择语言、地区）\n\n"
        "**不要用于**：\n"
        "- 普通的信息收集（用 clarify 工具）\n"
        "- 危险命令确认（terminal 工具自己有审批机制）\n"
        "- 用户已明确授权的常规自动化步骤\n\n"
        "**重要**：调用此工具后，你应当在用户返回后根据当前页面状态（先 browser_snapshot）"
        "再决定下一步操作，不要假设登录/验证成功。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": (
                    "向用户解释为什么需要暂停。例如："
                    "'YouTube 要求登录才能查看该博主的完整视频列表，请在右侧浏览器内完成登录后点击「下一步」'"
                ),
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "超时秒数（默认 600 = 10 分钟；最大 3600 = 1 小时）。超时后会自动继续。",
                "minimum": 5,
                "maximum": 3600,
                "default": 600,
            },
        },
        "required": ["reason"],
    },
}


registry.register(
    name="request_user_continue",
    toolset="browser",
    schema=USER_CONTINUE_SCHEMA,
    handler=lambda args, **kw: request_user_continue(
        reason=args.get("reason", ""),
        timeout_seconds=int(args.get("timeout_seconds", 600) or 600),
    ),
    check_fn=check_user_continue_requirements,
    emoji="⏸️",
)
