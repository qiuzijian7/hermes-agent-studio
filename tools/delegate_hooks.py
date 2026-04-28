"""
delegate_hooks.py — 软钩子注册表，允许外部（如 WebUI）观察 delegate_task 的生命周期事件。

★ 2026-04-27 新增
    解决 WebUI 场景下"制作人委派任务给下属员工后，员工聊天框看不到任务内容和
    思考过程"的问题——通过这里的钩子，WebUI 可以在 child agent 被创建、运行、
    结束的每个关键节点得到通知，从而：
        1. 在员工 session 中注入一条"制作人派的任务"user message
        2. 把 child 的 token/tool/reasoning 事件桥接到员工聊天面板（实时显示）
        3. 在 DelegationVM 里登记一个 Task，确保刷新后仍能加载历史消息

主仓 delegate_tool.py 通过 import 本模块并 try/except 调用这些回调（纯 optional，
不破坏 CLI / Gateway / Headless 等无 WebUI 环境的运行）。

用法（WebUI 注册方）：
    from tools.delegate_hooks import register_delegation_observer

    def _my_observer(event: str, data: dict) -> None:
        # event ∈ {"child.spawned", "child.token", "child.reasoning",
        #          "child.tool.started", "child.tool.completed",
        #          "child.completed", "child.failed"}
        ...

    register_delegation_observer(parent_session_id, _my_observer)

生命周期：
    1. 父 agent 调 delegate_task → 构造 N 个 child agent
    2. 每个 child 构造完成后 → 触发 "child.spawned"
    3. child.run_conversation 期间 → 触发 "child.token" / "child.reasoning" /
       "child.tool.started" / "child.tool.completed"
    4. child 结束后 → 触发 "child.completed" 或 "child.failed"

设计要点：
    - 线程安全：使用 threading.RLock 保护 _observers 字典
    - 观察者注册以父 session_id 为 key；同一个 parent 可能有多个观察者（罕见）
    - 回调异常不会中断 delegation：每次调用都 try/except
    - 数据 payload 保持简单（dict 可 JSON 序列化），便于 SSE 转发
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# 观察者签名： observer(event: str, data: dict) -> None
ObserverFn = Callable[[str, Dict[str, Any]], None]

# parent_session_id -> list of observers
_observers: Dict[str, List[ObserverFn]] = {}
_lock = threading.RLock()


def register_delegation_observer(parent_session_id: str, observer: ObserverFn) -> None:
    """注册一个观察者，监听指定父 session 下所有 child agent 的生命周期事件。"""
    if not parent_session_id or observer is None:
        return
    with _lock:
        _observers.setdefault(parent_session_id, []).append(observer)
    logger.debug("Registered delegation observer for parent=%s", parent_session_id)


def unregister_delegation_observer(parent_session_id: str,
                                   observer: Optional[ObserverFn] = None) -> None:
    """注销一个或所有观察者。若 observer=None，注销该 parent 下的所有观察者。"""
    with _lock:
        if parent_session_id not in _observers:
            return
        if observer is None:
            _observers.pop(parent_session_id, None)
        else:
            try:
                _observers[parent_session_id].remove(observer)
                if not _observers[parent_session_id]:
                    _observers.pop(parent_session_id, None)
            except ValueError:
                pass


def emit(parent_session_id: Optional[str], event: str, data: Dict[str, Any]) -> None:
    """
    向所有注册到 `parent_session_id` 的观察者广播一个事件。
    任何回调异常都会被 swallow 以保护 delegation 主流程。
    """
    if not parent_session_id:
        return
    with _lock:
        obs_list = list(_observers.get(parent_session_id, []))
    for obs in obs_list:
        try:
            obs(event, data)
        except Exception as e:  # pragma: no cover
            logger.debug("Delegation observer error: %s", e)


# ─────────────────────────────────────────────────────────────────────────────
# 便利函数：由 delegate_tool.py 调用，自动解析 parent_session_id
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_parent_sid(parent_agent) -> Optional[str]:
    if parent_agent is None:
        return None
    return getattr(parent_agent, "session_id", None) or None


def notify_child_spawned(parent_agent, child, task: Dict[str, Any], task_index: int) -> None:
    """child agent 构造完成、即将运行。"""
    psid = _resolve_parent_sid(parent_agent)
    if not psid:
        return
    emit(psid, "child.spawned", {
        "parent_session_id": psid,
        "child_session_id": getattr(child, "session_id", None),
        "task_index": task_index,
        "employee_name": task.get("employee_name") or "",
        "employee_role": task.get("employee_role") or "",
        "goal": task.get("goal") or "",
        "context": task.get("context") or "",
        "toolsets": task.get("toolsets") or [],
    })


def build_child_event_bridge(parent_agent, child, task: Dict[str, Any],
                             task_index: int) -> None:
    """
    把 child agent 的 stream_delta / reasoning / tool 事件桥接到父 session 的观察者。
    必须在 child.run_conversation 之前调用。

    做法：用包装器替换 child 的三个 callback（stream_delta_callback /
    reasoning_callback / tool_progress_callback），wrapper 先调用原 callback（保持
    已有行为），再 emit 到 delegation_hooks。
    """
    psid = _resolve_parent_sid(parent_agent)
    if not psid:
        return
    csid = getattr(child, "session_id", None)
    emp_name = task.get("employee_name") or ""
    emp_role = task.get("employee_role") or ""

    # --- stream_delta_callback ---
    orig_stream = getattr(child, "stream_delta_callback", None)

    def _stream_hook(delta: str, *args, **kwargs):
        try:
            emit(psid, "child.token", {
                "parent_session_id": psid,
                "child_session_id": csid,
                "task_index": task_index,
                "employee_name": emp_name,
                "delta": delta or "",
            })
        except Exception:
            pass
        if orig_stream is not None:
            try:
                return orig_stream(delta, *args, **kwargs)
            except Exception:
                return None
        return None

    # --- reasoning_callback ---
    orig_reasoning = getattr(child, "reasoning_callback", None)

    def _reasoning_hook(delta: str, *args, **kwargs):
        try:
            emit(psid, "child.reasoning", {
                "parent_session_id": psid,
                "child_session_id": csid,
                "task_index": task_index,
                "employee_name": emp_name,
                "delta": delta or "",
            })
        except Exception:
            pass
        if orig_reasoning is not None:
            try:
                return orig_reasoning(delta, *args, **kwargs)
            except Exception:
                return None
        return None

    # --- tool_progress_callback --- （拦截 tool.started / tool.completed）
    orig_progress = getattr(child, "tool_progress_callback", None)

    def _progress_hook(*cb_args, **cb_kwargs):
        # 解析可变参数
        phase = "tool.misc"
        tname = ""
        preview = ""
        targs: Any = None
        if len(cb_args) >= 4:
            phase, tname, preview, targs = cb_args[0], cb_args[1], cb_args[2], cb_args[3]
        elif len(cb_args) == 3:
            tname, preview, targs = cb_args
            phase = "tool.started"
        elif len(cb_args) == 2:
            phase, tname = cb_args
        elif len(cb_args) == 1:
            tname = cb_args[0]

        if phase in ("tool.started", "tool.completed"):
            try:
                emit(psid, f"child.{phase}", {
                    "parent_session_id": psid,
                    "child_session_id": csid,
                    "task_index": task_index,
                    "employee_name": emp_name,
                    "tool_name": tname or "",
                    "preview": str(preview or "")[:400],
                    "args": (targs if isinstance(targs, dict) else None),
                    "duration": float(cb_kwargs.get("duration", 0) or 0),
                    "is_error": bool(cb_kwargs.get("is_error", False)),
                })
            except Exception:
                pass

        if orig_progress is not None:
            try:
                return orig_progress(*cb_args, **cb_kwargs)
            except Exception:
                return None
        return None

    # 挂回 child
    try:
        child.stream_delta_callback = _stream_hook
        child.reasoning_callback = _reasoning_hook
        child.tool_progress_callback = _progress_hook
    except Exception as e:
        logger.debug("Failed to wrap child callbacks: %s", e)


def notify_child_completed(parent_agent, child, task: Dict[str, Any],
                           task_index: int, entry: Dict[str, Any]) -> None:
    """child agent 结束后调用，带上最终 summary / status / messages。"""
    psid = _resolve_parent_sid(parent_agent)
    if not psid:
        return
    # 提取消息用于前端一次性渲染历史（和 DelegationVM.task.sessionId 配合）
    child_messages: List[Any] = []
    try:
        # child.messages 是内存中的对话（已 append tool results 等）
        child_messages = list(getattr(child, "messages", []) or [])
    except Exception:
        child_messages = []

    emit(psid, "child.completed", {
        "parent_session_id": psid,
        "child_session_id": getattr(child, "session_id", None),
        "task_index": task_index,
        "employee_name": task.get("employee_name") or "",
        "employee_role": task.get("employee_role") or "",
        "goal": task.get("goal") or "",
        "status": entry.get("status") or "",
        "summary": entry.get("summary") or "",
        "duration_seconds": entry.get("duration_seconds", 0),
        "api_calls": entry.get("api_calls", 0),
        "error": entry.get("error"),
        # 不传 child_messages（避免 payload 过大）；前端可以通过 /api/session?session_id=child_sid 拉
    })
