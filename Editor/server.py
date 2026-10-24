#!/usr/bin/env python3
"""Local editing studio for the blackball blog.

Start with:
    python Editor/server.py

The server binds to 127.0.0.1 only. It writes Markdown under posts/ and calls
build.py when the editor publishes.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import webbrowser
from datetime import date as Date
from pathlib import Path
from urllib.parse import quote

try:
    from flask import Flask, abort, jsonify, request, send_from_directory
except ImportError:
    print(
        "error: Flask is missing.\n"
        "install it with: python -m pip install -r Editor/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
EDITOR_DIR = Path(__file__).resolve().parent
DIST_DIR = EDITOR_DIR / "frontend" / "dist"
POSTS_DIR = ROOT / "posts"
IMAGES_DIR = ROOT / "imgs"
SITE_FILE = ROOT / "site.json"
BUILD_SCRIPT = ROOT / "build.py"
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

sys.path.insert(0, str(ROOT))
try:
    import build as site_build
except ImportError:
    print(
        "error: Markdown is missing.\n"
        "install it with: python -m pip install -r Editor/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(1)


app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
TOKEN = secrets.token_urlsafe(32)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SLUG_RE = re.compile(r"[^\w\u4e00-\u9fff-]+", re.UNICODE)
DASH_RE = re.compile(r"-{2,}")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


@app.before_request
def guard_api():
    if request.path.startswith("/api/") and request.method in {
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
    }:
        supplied = request.headers.get("X-Editor-Token", "")
        if not supplied or not hmac.compare_digest(supplied, TOKEN):
            return error("编辑令牌无效，请刷新页面后重试。", 403)
    return None


@app.errorhandler(ApiError)
def handle_api_error(exc: ApiError):
    return error(exc.message, exc.status)


@app.errorhandler(413)
def handle_too_large(_exc):
    return error("图片不能超过 8 MB。", 413)


def slugify(value: str) -> str:
    slug = SLUG_RE.sub("-", value.strip())
    slug = DASH_RE.sub("-", slug).strip("-_").lower()
    return slug[:64].rstrip("-_") or "post"


def one_line(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise ApiError(f"{field} 必须是字符串。")
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned


def post_filename(published: Date, slug: str) -> str:
    return f"{published.isoformat()}-{slug}.md"


def safe_post_path(filename: str) -> Path:
    if (
        not filename
        or filename.startswith(".")
        or not filename.endswith(".md")
        or "/" in filename
        or "\\" in filename
    ):
        raise ApiError("文章文件名无效。")
    path = (POSTS_DIR / filename).resolve()
    try:
        path.relative_to(POSTS_DIR.resolve())
    except ValueError as exc:
        raise ApiError("文章路径越界。") from exc
    if not path.is_file():
        raise ApiError("文章不存在。", 404)
    return path


def parse_post(path: Path, include_body: bool = True) -> dict:
    match = site_build.POST_FILENAME_RE.match(path.name)
    if not match:
        raise ApiError(f"{path.name}: 文件名必须是 YYYY-MM-DD-slug.md。")
    try:
        published = Date(
            int(match.group("year")),
            int(match.group("month")),
            int(match.group("day")),
        )
    except ValueError as exc:
        raise ApiError(f"{path.name}: 日期无效。") from exc

    try:
        raw = path.read_text(encoding="utf-8-sig")
        metadata, source = site_build.parse_front_matter(raw, path)
        title, body = site_build.extract_title(source, path)
    except site_build.BuildError as exc:
        raise ApiError(str(exc)) from exc

    summary = {
        "file": path.name,
        "title": title,
        "date": published.isoformat(),
        "date_display": f"{published.year:04d}.{published.month:02d}.{published.day:02d}",
        "author": metadata.get("author", ""),
        "year": metadata.get("year", ""),
        "preview_url": f"/preview/html/{quote(path.stem)}.html",
    }
    if include_body:
        summary["body"] = body
    return summary


def list_posts() -> list[dict]:
    if not POSTS_DIR.is_dir():
        raise ApiError("posts/ 不存在。", 500)
    posts: list[dict] = []
    for path in sorted(POSTS_DIR.glob("*.md"), reverse=True):
        if path.name.startswith("."):
            continue
        try:
            posts.append(parse_post(path, include_body=False))
        except ApiError as exc:
            posts.append(
                {
                    "file": path.name,
                    "title": path.stem,
                    "date": "",
                    "date_display": "",
                    "author": "",
                    "year": "",
                    "preview_url": "",
                    "error": exc.message,
                }
            )
    return posts


def payload() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("请求体必须是 JSON。")
    return data


def clean_body(value: object) -> str:
    if not isinstance(value, str):
        raise ApiError("正文必须是字符串。")
    return value.replace("\r\n", "\n").strip("\n")


def serialize_post(title: str, body: str, author: str, year: str) -> str:
    title = title.strip()
    if not title:
        raise ApiError("标题不能为空。")
    if "\n" in title or "\r" in title:
        raise ApiError("标题只能是一行。")

    chunks: list[str] = []
    if author or year:
        lines = ["---"]
        if author:
            lines.append(f"author: {author}")
        if year:
            lines.append(f"year: {year}")
        lines.append("---")
        chunks.append("\n".join(lines))
    chunks.append(f"## {title}")
    body = body.strip("\n")
    if body:
        chunks.append(body)
    return "\n\n".join(chunks) + "\n"


def write_atomic(path: Path, text: str) -> None:
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temp, path)


def run_build() -> tuple[bool, str, int, int]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        process = subprocess.run(
            [sys.executable, str(BUILD_SCRIPT)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") + (exc.stderr or "")
        return False, output + "\n构建超时。", 0, 0
    except OSError as exc:
        return False, f"无法启动 build.py: {exc}", 0, 0

    output = ((process.stdout or "") + (process.stderr or "")).strip()
    post_count = len(list(POSTS_DIR.glob("*.md")))
    page_count = len(list((ROOT / "html").glob("*.html"))) + 2
    return process.returncode == 0, output, post_count, page_count


SITE_FIELDS = (
    "title",
    "tagline",
    "description",
    "author",
    "footer_motto",
    "brush_font",
    "not_found_title",
    "not_found_body",
)


def read_site() -> dict:
    try:
        data = json.loads(SITE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ApiError("site.json 不存在。", 500) from exc
    except json.JSONDecodeError as exc:
        raise ApiError(f"site.json 不是有效 JSON：{exc}", 500) from exc
    if not isinstance(data, dict):
        raise ApiError("site.json 顶层必须是对象。", 500)
    data.setdefault("logo", "imgs/logo.png")
    data.setdefault("brush_font", "zhi-mang-xing")
    data.setdefault("not_found_title", "这条路径不存在。")
    data.setdefault("not_found_body", "页面可能已经被移走，或者还没有被写下。")
    return data


def font_options() -> list[dict]:
    return [
        {
            "id": key,
            "label": font["label"],
            "family": font["family"],
            "css": font["css"],
            "google": font["google"],
        }
        for key, font in site_build.BRUSH_FONTS.items()
    ]


def site_response(config: dict):
    return jsonify({"ok": True, "site": config, "fonts": font_options()})


def write_site(config: dict) -> None:
    text = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    temp = SITE_FILE.with_name(SITE_FILE.name + ".tmp")
    temp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temp, SITE_FILE)


def image_url(name: str) -> str:
    return f"/preview/imgs/{quote(name)}"


def image_markdown(name: str, alt: str) -> str:
    safe_alt = alt.replace("]", "").strip() or "图片"
    return f"![{safe_alt}](../imgs/{name})"


def image_summary(path: Path, logo: str) -> dict:
    return {
        "name": path.name,
        "path": f"imgs/{path.name}",
        "url": image_url(path.name),
        "markdown": image_markdown(path.name, path.stem),
        "size": path.stat().st_size,
        "modified": int(path.stat().st_mtime),
        "is_logo": f"imgs/{path.name}" == logo,
    }


def list_images() -> list[dict]:
    if not IMAGES_DIR.is_dir():
        return []
    logo = str(read_site().get("logo", ""))
    files = [
        path
        for path in IMAGES_DIR.iterdir()
        if path.is_file()
        and not path.name.startswith(".")
        and path.suffix.lower() in ALLOWED_IMAGE_EXTENSIONS
    ]
    files.sort(key=lambda path: (path.stat().st_mtime, path.name), reverse=True)
    return [image_summary(path, logo) for path in files]


def safe_image_path(name: str) -> Path:
    if (
        not name
        or name.startswith(".")
        or "/" in name
        or "\\" in name
        or Path(name).suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS
    ):
        raise ApiError("图片文件名无效。")
    path = (IMAGES_DIR / name).resolve()
    try:
        path.relative_to(IMAGES_DIR.resolve())
    except ValueError as exc:
        raise ApiError("图片路径越界。") from exc
    if not path.is_file():
        raise ApiError("图片不存在。", 404)
    return path


def validate_logo_path(value: object) -> str:
    if not isinstance(value, str):
        raise ApiError("logo 路径无效。")
    value = value.strip().lstrip("/")
    if not value.startswith("imgs/"):
        raise ApiError("logo 必须位于 imgs/ 目录。")
    name = value[5:]
    safe_image_path(name)
    return value


def read_create_fields(data: dict) -> tuple[str, str, Date, str, str]:
    title = one_line(data.get("title", ""), "标题")
    if not title:
        raise ApiError("标题不能为空。")
    author = one_line(data.get("author", ""), "作者")
    year = one_line(data.get("year", ""), "年份")
    body = clean_body(data.get("body", ""))
    date_value = data.get("date") or Date.today().isoformat()
    if not isinstance(date_value, str) or not DATE_RE.match(date_value):
        raise ApiError("日期必须是 YYYY-MM-DD。")
    try:
        published = Date.fromisoformat(date_value)
    except ValueError as exc:
        raise ApiError("日期无效。") from exc
    slug = slugify(str(data.get("slug", "") or title))
    return title, body, published, author, year


def editor_response_status(ok: bool, output: str, count: int, pages: int):
    payload = {
        "ok": ok,
        "output": output,
        "posts": count,
        "pages": pages,
    }
    return jsonify(payload), (200 if ok else 500)


@app.get("/api/bootstrap")
def bootstrap():
    try:
        config = site_build.load_config()
        site_title = config.get("title", "blackball")
    except site_build.BuildError:
        site_title = "blackball"
    return jsonify(
        {
            "ok": True,
            "token": TOKEN,
            "siteTitle": site_title,
            "today": Date.today().isoformat(),
            "previewUrl": "/preview/",
            "posts": len(list(POSTS_DIR.glob("*.md"))),
        }
    )


@app.get("/api/site")
def get_site():
    return site_response(read_site())


@app.put("/api/site")
def update_site():
    data = payload()
    config = read_site()
    for key in SITE_FIELDS:
        if key not in data:
            continue
        value = one_line(data[key], key)
        if key in {"title", "tagline", "description", "author", "footer_motto"} and not value:
            raise ApiError(f"{key} 不能为空。")
        if key == "brush_font" and value not in site_build.BRUSH_FONTS:
            raise ApiError("未知的毛笔字体。")
        config[key] = value
    if "logo" in data:
        config["logo"] = validate_logo_path(data["logo"])
    write_site(config)
    return site_response(config)


@app.post("/api/site/logo")
def set_logo():
    data = payload()
    config = read_site()
    config["logo"] = validate_logo_path(data.get("logo"))
    write_site(config)
    return site_response(config)


@app.get("/api/images")
def get_images():
    return jsonify(
        {
            "ok": True,
            "images": list_images(),
            "logo": str(read_site().get("logo", "")),
        }
    )


@app.post("/api/images")
def upload_image():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise ApiError("没有收到图片文件。")
    extension = Path(upload.filename).suffix.lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ApiError("只支持 PNG、JPG、JPEG、WebP 和 GIF。")
    if upload.content_length and upload.content_length > 8 * 1024 * 1024:
        raise ApiError("图片不能超过 8 MB。", 413)

    stem = SLUG_RE.sub("-", Path(upload.filename).stem).strip("-_").lower()[:48]
    stem = stem or "image"
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{stem}{extension}"
    counter = 2
    while (IMAGES_DIR / name).exists():
        name = f"{stem}-{counter}{extension}"
        counter += 1

    path = IMAGES_DIR / name
    upload.save(path)
    return jsonify({"ok": True, "image": image_summary(path, str(read_site().get("logo", "")))}), 201


@app.delete("/api/images/<path:name>")
def delete_image(name: str):
    path = safe_image_path(name)
    config_text = SITE_FILE.read_text(encoding="utf-8")
    used_by: list[str] = []
    if name in config_text:
        used_by.append("site.json")
    for post in sorted(POSTS_DIR.glob("*.md")):
        try:
            if name in post.read_text(encoding="utf-8"):
                used_by.append(post.name)
        except UnicodeDecodeError:
            continue
    if used_by:
        raise ApiError(
            "图片仍在使用中，不能删除：" + "、".join(used_by[:4]),
            409,
        )
    path.unlink()
    return jsonify({"ok": True})


@app.get("/api/posts")
def get_posts():
    return jsonify({"ok": True, "posts": list_posts()})


@app.get("/api/posts/<path:filename>")
def get_post(filename: str):
    path = safe_post_path(filename)
    return jsonify({"ok": True, "post": parse_post(path)})


@app.post("/api/posts")
def create_post():
    data = payload()
    title, body, published, author, year = read_create_fields(data)
    slug = slugify(str(data.get("slug", "") or title))
    filename = post_filename(published, slug)
    path = POSTS_DIR / filename
    if path.exists():
        raise ApiError(f"{filename} 已存在，请换一个标题或 slug。", 409)
    write_atomic(path, serialize_post(title, body, author, year))
    return jsonify({"ok": True, "post": parse_post(path)}), 201


@app.put("/api/posts/<path:filename>")
def update_post(filename: str):
    path = safe_post_path(filename)
    data = payload()
    title = one_line(data.get("title", ""), "标题")
    author = one_line(data.get("author", ""), "作者")
    year = one_line(data.get("year", ""), "年份")
    body = clean_body(data.get("body", ""))
    write_atomic(path, serialize_post(title, body, author, year))
    return jsonify({"ok": True, "post": parse_post(path)})


@app.delete("/api/posts/<path:filename>")
def delete_post(filename: str):
    path = safe_post_path(filename)
    path.unlink()
    return jsonify({"ok": True})


@app.post("/api/publish")
def publish():
    ok, output, post_count, page_count = run_build()
    return editor_response_status(ok, output, post_count, page_count)


def editor_index():
    if not (DIST_DIR / "index.html").is_file():
        return (
            "Editor UI is not built.\n\n"
            "Run: cd Editor/frontend && pnpm install && pnpm build\n"
            "Then restart: python Editor/server.py\n",
            503,
            {"Content-Type": "text/plain; charset=utf-8"},
        )
    return send_from_directory(DIST_DIR, "index.html")


@app.get("/")
def index():
    return editor_index()


@app.get("/preview/", strict_slashes=False)
def preview_index():
    return send_from_directory(ROOT, "index.html")


@app.get("/preview/<path:asset>")
def preview_asset(asset: str):
    target = (ROOT / asset).resolve()
    try:
        target.relative_to(ROOT)
    except ValueError:
        abort(404)
    if not target.is_file():
        abort(404)
    return send_from_directory(ROOT, asset)


@app.get("/<path:filename>")
def editor_asset(filename: str):
    if filename.startswith(("api/", "preview/")):
        abort(404)
    target = (DIST_DIR / filename).resolve()
    try:
        target.relative_to(DIST_DIR.resolve())
    except ValueError:
        abort(404)
    if target.is_file():
        return send_from_directory(DIST_DIR, filename)
    return editor_index()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local blackball editor.")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args(argv)

    if not (DIST_DIR / "index.html").is_file():
        print(
            "warning: Editor frontend is not built.\n"
            "  cd Editor/frontend && pnpm install && pnpm build",
            file=sys.stderr,
        )

    url = f"http://127.0.0.1:{args.port}/"
    print(f"editor: {url}")
    print("preview: /preview/ (available after starting)")
    print("bound to 127.0.0.1 only; press Ctrl+C to stop")
    if not args.no_open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    app.run(
        host="127.0.0.1",
        port=args.port,
        debug=False,
        use_reloader=False,
        threaded=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
