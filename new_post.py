#!/usr/bin/env python3
"""Create a new post and open it in your editor.

Examples:
    python new_post.py "一篇新文章"
    python new_post.py "背影" --author 朱自清 --year 1925
    python new_post.py "一篇文章" --slug my-post --serve
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
POSTS_DIR = ROOT / "posts"
SLUG_RE = re.compile(r"[^\w\u4e00-\u9fff-]+", re.UNICODE)


def slugify(title: str) -> str:
    slug = SLUG_RE.sub("-", title.strip())
    slug = re.sub(r"-{2,}", "-", slug).strip("-_").lower()
    return slug[:64].rstrip("-_") or "post"


def build_front_matter(author: str, year: str) -> str:
    if not author and not year:
        return ""
    lines = ["---"]
    if author:
        lines.append(f"author: {author}")
    if year:
        lines.append(f"year: {year}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def find_editor() -> list[str] | None:
    configured = os.environ.get("VISUAL") or os.environ.get("EDITOR")
    if configured:
        return shlex.split(configured, posix=(os.name != "nt"))

    if shutil.which("code"):
        return ["code", "--wait"]
    if os.name == "nt" and shutil.which("notepad"):
        return ["notepad"]
    for candidate in ("nano", "vim", "vi"):
        if shutil.which(candidate):
            return [candidate]
    return None


def open_editor(path: Path) -> bool:
    editor = find_editor()
    if not editor:
        print("No editor found. Set $EDITOR or open the file manually.", file=sys.stderr)
        return False
    print(f"opening in {Path(editor[0]).name}...")
    try:
        result = subprocess.run([*editor, str(path)], check=False)
    except OSError as exc:
        print(f"could not open editor: {exc}", file=sys.stderr)
        return False
    return result.returncode == 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a Markdown post, then optionally build and preview it."
    )
    parser.add_argument("title", nargs="?", help="post title; prompts if omitted")
    parser.add_argument("--author", default="", help="optional author name")
    parser.add_argument("--year", default="", help="optional work year, e.g. 1925")
    parser.add_argument(
        "--date",
        default=date.today().isoformat(),
        help="post date in YYYY-MM-DD (default: today)",
    )
    parser.add_argument("--slug", default="", help="URL filename slug")
    parser.add_argument(
        "--no-open", action="store_true", help="create the file without opening an editor"
    )
    parser.add_argument(
        "--no-build", action="store_true", help="do not rebuild after editing"
    )
    parser.add_argument(
        "--serve", action="store_true", help="build, then start the local preview server"
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="preview port (default: 8000)"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    title = (args.title or "").strip()
    if not title:
        try:
            title = input("标题: ").strip()
        except EOFError:
            title = ""
    if not title:
        print("error: title is required", file=sys.stderr)
        return 1

    try:
        published = date.fromisoformat(args.date)
    except ValueError:
        print("error: --date must be YYYY-MM-DD", file=sys.stderr)
        return 1

    slug = slugify(args.slug or title)
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    path = POSTS_DIR / f"{published.isoformat()}-{slug}.md"
    if path.exists():
        print(f"error: {path.relative_to(ROOT)} already exists", file=sys.stderr)
        return 1

    body = (
        build_front_matter(args.author.strip(), args.year.strip())
        + f"## {title}\n\n"
        + "\n"
    )
    path.write_text(body, encoding="utf-8", newline="\n")
    print(f"created: {path.relative_to(ROOT)}")

    edited = True
    if not args.no_open:
        edited = open_editor(path)

    if not args.no_build or args.serve:
        sys.path.insert(0, str(ROOT))
        try:
            import build  # imported here so --no-build works without dependencies
        except ImportError as exc:
            print(
                "could not import build.py; install requirements.txt first",
                file=sys.stderr,
            )
            print(f"  {exc}", file=sys.stderr)
            return 1

        try:
            if args.serve:
                build.serve(args.port)
            else:
                build.build()
        except build.BuildError as exc:
            print(f"build failed: {exc}", file=sys.stderr)
            print(f"the draft is still at {path.relative_to(ROOT)}", file=sys.stderr)
            return 1
        except KeyboardInterrupt:
            print("\nstopped")

    if not edited:
        print("the editor exited with an error; the file was still created")

    print("")
    print("next:")
    print("  python build.py --serve")
    print(f"  review {path.relative_to(ROOT)}, then git add / commit / push")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
