from __future__ import annotations

import json
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

try:
    from .claude_parser import ClaudeParseError, parse_claude_export
except ImportError:
    from claude_parser import ClaudeParseError, parse_claude_export


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)

    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/<path:path>")
    def static_files(path: str):
        return send_from_directory(FRONTEND_DIR, path)

    @app.post("/api/parse")
    def parse_upload():
        upload = request.files.get("file")
        if upload is None:
            return jsonify({"error": "请上传 Claude 导出 zip 或 JSON 文件。"}), 400

        try:
            payload = parse_export_file(upload.read(), upload.filename or "")
        except ClaudeParseError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify(payload)

    return app


def parse_export_file(data: bytes, filename: str) -> dict[str, Any]:
    if filename.lower().endswith(".zip") or zipfile.is_zipfile(BytesIO(data)):
        return parse_export_zip(data)

    raw = data.decode("utf-8-sig", errors="replace")
    result = parse_claude_export(raw)
    return {
        "conversations": result.conversations,
        "stats": result.stats,
        "warnings": result.warnings,
        "users": [],
        "memories": [],
        "projects": [],
    }


def parse_export_zip(data: bytes) -> dict[str, Any]:
    warnings: list[str] = []
    users: list[dict[str, Any]] = []
    memories: list[dict[str, Any]] = []
    projects: list[dict[str, Any]] = []
    conversations_result = None

    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ClaudeParseError("上传的文件不是有效 zip。") from exc

    names = [name for name in archive.namelist() if not name.endswith("/") and not _is_ignored_zip_entry(name)]
    by_basename = {Path(name).name: name for name in names}

    conversations_name = by_basename.get("conversations.json")
    if conversations_name:
        conversations_result = parse_claude_export(_read_zip_text(archive, conversations_name))
        warnings.extend(conversations_result.warnings)
    else:
        warnings.append("zip 中未找到 conversations.json。")

    users_name = by_basename.get("users.json")
    if users_name:
        users = _json_list(_read_zip_json(archive, users_name))
    else:
        warnings.append("zip 中未找到 users.json。")

    memories_name = by_basename.get("memories.json")
    if memories_name:
        memories = _json_list(_read_zip_json(archive, memories_name))
    else:
        warnings.append("zip 中未找到 memories.json。")

    for name in sorted(names):
        parts = Path(name).parts
        if len(parts) >= 2 and "projects" in parts and name.lower().endswith(".json"):
            project = _read_zip_json(archive, name)
            if isinstance(project, dict):
                projects.append(_normalize_project(project, name))

    if not conversations_result:
        raise ClaudeParseError("zip 中没有可解析的 conversations.json。")

    return {
        "conversations": conversations_result.conversations,
        "stats": {
            **conversations_result.stats,
            "user_count": len(users),
            "memory_count": len(memories),
            "project_count": len(projects),
        },
        "warnings": warnings,
        "users": users,
        "memories": memories,
        "projects": projects,
    }


def _is_ignored_zip_entry(name: str) -> bool:
    path = Path(name)
    return path.name == ".DS_Store" or "__MACOSX" in path.parts


def _read_zip_text(archive: zipfile.ZipFile, name: str) -> str:
    return archive.read(name).decode("utf-8-sig", errors="replace")


def _read_zip_json(archive: zipfile.ZipFile, name: str) -> Any:
    return json.loads(_read_zip_text(archive, name))


def _json_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _normalize_project(project: dict[str, Any], source_path: str) -> dict[str, Any]:
    docs = [doc for doc in project.get("docs") or [] if isinstance(doc, dict)]
    return {
        "id": project.get("uuid") or "",
        "name": project.get("name") or "未命名项目",
        "description": project.get("description") or "",
        "prompt_template": project.get("prompt_template") or "",
        "created_at": project.get("created_at") or "",
        "updated_at": project.get("updated_at") or "",
        "is_private": bool(project.get("is_private")),
        "is_starter_project": bool(project.get("is_starter_project")),
        "creator": project.get("creator") or {},
        "source_path": source_path,
        "doc_count": len(docs),
        "docs": [
            {
                "id": doc.get("uuid") or "",
                "filename": doc.get("filename") or "未命名文档",
                "content": doc.get("content") or "",
                "created_at": doc.get("created_at") or "",
            }
            for doc in docs
        ],
    }


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
