from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from typing import Any


class ClaudeParseError(ValueError):
    """Raised when no Claude conversation can be decoded from an export."""


@dataclass
class ParseResult:
    conversations: list[dict[str, Any]]
    stats: dict[str, Any]
    warnings: list[str]


def parse_claude_export(raw: str) -> ParseResult:
    """Parse Claude exports and pasted snippets into a normalized shape.

    The official export normally contains JSON, but user-copied samples can be:
    - a single conversation object
    - an array of conversation objects
    - explanatory text followed by comma-separated objects
    - a truncated sequence where early objects are still valid
    """

    warnings: list[str] = []
    decoded = _decode_payload(raw, warnings)
    conversations = [_normalize_conversation(item) for item in decoded]
    stats = _build_stats(conversations, warnings)
    return ParseResult(conversations=conversations, stats=stats, warnings=warnings)


def _decode_payload(raw: str, warnings: list[str]) -> list[dict[str, Any]]:
    text = raw.lstrip("\ufeff")

    try:
        return _as_conversation_list(json.loads(text))
    except json.JSONDecodeError:
        pass

    start_candidates = [pos for pos in (text.find("{"), text.find("[")) if pos != -1]
    if not start_candidates:
        raise ClaudeParseError("没有找到 JSON 对象或数组。")

    start = min(start_candidates)
    if start > 0:
        warnings.append(f"已忽略 JSON 前面的说明文字，共 {start} 个字符。")

    decoder = json.JSONDecoder()
    items: list[dict[str, Any]] = []
    index = start

    while index < len(text):
        while index < len(text) and text[index] in " \t\r\n,[]":
            index += 1
        if index >= len(text):
            break

        try:
            value, end = decoder.raw_decode(text, index)
        except json.JSONDecodeError as exc:
            if items:
                warnings.append(
                    f"在第 {exc.pos} 个字符附近停止解析；前面 {len(items)} 个会话已成功读取，后续内容可能被截断。"
                )
                break
            raise ClaudeParseError(f"JSON 解析失败：{exc.msg}") from exc

        items.extend(_as_conversation_list(value))
        index = end

    if not items:
        raise ClaudeParseError("没有解析到 Claude 会话对象。")

    return items


def _as_conversation_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _normalize_conversation(item: dict[str, Any]) -> dict[str, Any]:
    messages = [_normalize_message(msg) for msg in item.get("chat_messages") or [] if isinstance(msg, dict)]
    human_count = sum(1 for msg in messages if msg["sender"] == "human")
    assistant_count = sum(1 for msg in messages if msg["sender"] == "assistant")

    return {
        "id": item.get("uuid") or "",
        "title": item.get("name") or "未命名对话",
        "summary": item.get("summary") or "",
        "created_at": item.get("created_at") or "",
        "updated_at": item.get("updated_at") or "",
        "account_id": (item.get("account") or {}).get("uuid") if isinstance(item.get("account"), dict) else "",
        "message_count": len(messages),
        "human_count": human_count,
        "assistant_count": assistant_count,
        "messages": messages,
    }


def _normalize_message(item: dict[str, Any]) -> dict[str, Any]:
    blocks = [_normalize_block(block) for block in item.get("content") or [] if isinstance(block, dict)]
    text = item.get("text") or _join_block_text(blocks)

    return {
        "id": item.get("uuid") or "",
        "sender": item.get("sender") or "unknown",
        "created_at": item.get("created_at") or "",
        "updated_at": item.get("updated_at") or "",
        "parent_id": item.get("parent_message_uuid") or "",
        "text": text,
        "attachments": item.get("attachments") or [],
        "files": item.get("files") or [],
        "blocks": blocks,
    }


def _normalize_block(item: dict[str, Any]) -> dict[str, Any]:
    block_type = item.get("type") or "unknown"
    text = ""

    if block_type == "text":
        text = item.get("text") or ""
    elif block_type == "thinking":
        text = item.get("thinking") or ""
    elif block_type == "tool_result":
        text = _tool_result_text(item.get("content"))
    else:
        text = item.get("text") or item.get("thinking") or _compact_json(item)

    return {
        "type": block_type,
        "text": text,
        "start_timestamp": item.get("start_timestamp"),
        "stop_timestamp": item.get("stop_timestamp"),
        "is_error": item.get("is_error"),
        "name": item.get("name") or item.get("message"),
        "meta": _block_meta(item),
    }


def _tool_result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or _compact_json(item)))
            else:
                parts.append(str(item))
        return "\n".join(part for part in parts if part)
    if content is None:
        return ""
    return _compact_json(content)


def _block_meta(item: dict[str, Any]) -> dict[str, Any]:
    omit = {"text", "thinking", "content"}
    return {key: value for key, value in item.items() if key not in omit and value not in (None, [], {})}


def _compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _join_block_text(blocks: list[dict[str, Any]]) -> str:
    return "\n\n".join(block["text"] for block in blocks if block.get("text"))


def _build_stats(conversations: list[dict[str, Any]], warnings: list[str]) -> dict[str, Any]:
    sender_counts: Counter[str] = Counter()
    content_type_counts: Counter[str] = Counter()
    total_messages = 0
    total_chars = 0

    for conversation in conversations:
        for message in conversation["messages"]:
            total_messages += 1
            total_chars += len("".join(str(message.get("text") or "").split()))
            sender_counts[message["sender"]] += 1
            for block in message["blocks"]:
                content_type_counts[block["type"]] += 1

    return {
        "conversation_count": len(conversations),
        "message_count": total_messages,
        "total_char_count": total_chars,
        "sender_counts": dict(sender_counts),
        "content_type_counts": dict(content_type_counts),
        "has_warnings": bool(warnings),
    }
