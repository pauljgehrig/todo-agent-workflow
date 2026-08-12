#!/usr/bin/env python3
"""Mirror the shared Emmy KB (START-HERE topline + six domain toplines) into
the Notion 'Emmy KB digest' page. Wipe-and-rewrite everything below the
'Digest' heading; the Activity log section above it is preserved. Idempotent."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

REPO = os.path.expanduser("~/code/emmy-project-context")
ENV = os.path.expanduser("~/.config/todo-intake/env")
API = "https://api.notion.com/v1"


def load_env():
    vals = {}
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k] = v.strip().strip('"')
    return vals


E = load_env()
TOKEN, PAGE = E["NOTION_TOKEN"], E["NOTION_EMMY_KB_PAGE_ID"]


def req(method, path, body=None):
    r = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Notion-Version": "2025-09-03",
                 "Content-Type": "application/json"})
    for _ in range(5):
        try:
            with urllib.request.urlopen(r) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(int(e.headers.get("Retry-After", "2")))
                continue
            print(e.read().decode(), file=sys.stderr)
            raise
    raise RuntimeError("rate-limited too long")


def children(block_id):
    out, cursor = [], None
    while True:
        q = "?page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
        d = req("GET", f"/blocks/{block_id}/children{q}")
        out += d["results"]
        if not d.get("has_more"):
            return out
        cursor = d["next_cursor"]


def chunks(md, limit=1900):
    """Split markdown into <=limit-char chunks on paragraph boundaries
    (Notion caps a text object at 2000 chars)."""
    parts, cur = [], ""
    for para in md.split("\n\n"):
        while len(para) > limit:
            parts.append(para[:limit])
            para = para[limit:]
        if len(cur) + len(para) + 2 > limit:
            if cur:
                parts.append(cur)
            cur = para
        else:
            cur = f"{cur}\n\n{para}" if cur else para
    if cur:
        parts.append(cur)
    return parts


def paragraphs(md):
    return [{"type": "paragraph", "paragraph": {"rich_text":
             [{"type": "text", "text": {"content": c}}]}} for c in chunks(md)]


def read(rel):
    with open(os.path.join(REPO, rel)) as f:
        return f.read()


DOMAINS = [("Product", "domains/_product.md"), ("Policy", "domains/_policy.md"),
           ("Research", "domains/_research.md"), ("Design", "domains/_design.md"),
           ("Engineering", "domains/_engineering.md"), ("States", "domains/_states.md")]


def heading_text(b):
    t = b["type"]
    if not t.startswith("heading"):
        return ""
    return "".join(x["plain_text"] for x in b[t]["rich_text"]).strip().lower()


kids = children(PAGE)
digest_idx = next(i for i, b in enumerate(kids) if heading_text(b) == "digest")
for b in kids[digest_idx + 1:]:
    req("DELETE", f"/blocks/{b['id']}")

blocks = paragraphs(read("START-HERE.md"))
for title, rel in DOMAINS:
    blocks.append({"type": "toggle", "toggle": {
        "rich_text": [{"type": "text", "text": {"content": title}}],
        "children": paragraphs(read(rel))}})

for i in range(0, len(blocks), 100):
    req("PATCH", f"/blocks/{PAGE}/children", {"children": blocks[i:i + 100]})

print(f"Synced {len(blocks)} top-level digest blocks to the Emmy KB digest page.")
