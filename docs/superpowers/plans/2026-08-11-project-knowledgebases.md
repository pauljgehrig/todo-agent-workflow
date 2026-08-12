# Per-Project Knowledgebases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the to-do sweep agents (local `/todo-intake` and the hourly cloud routine) per-project knowledgebase context in Notion — read during Enrich, written back during File.

**Architecture:** One Notion "Agent KB index" page maps Project → KB page + type. Every KB page has an "Activity log" section (agent-appended, both surfaces) above a "Digest" section. Compound's digest is agent-owned; Emmy's digest is a read-only mirror of `~/code/emmy-project-context` refreshed by a sync script wired into the Friday `/update` loop, which also harvests the activity log back into the shared repo.

**Tech Stack:** Notion public API (`Notion-Version: 2025-09-03`) via curl/token locally and connector in the cloud routine; python3 (stdlib only) for the sync script; Claude Code skills (`~/.claude/skills/todo-intake/SKILL.md`, `~/.claude/commands/update.md`); `schedule` skill for the routine prompt.

**Spec:** `docs/superpowers/specs/2026-08-11-project-knowledgebases-design.md`

## Global Constraints

- Cloud routine sandbox has **no local files and no secrets** — everything it needs must be reachable via the Notion connector or literal (non-secret) IDs in its prompt.
- Local path uses the integration token from `~/.config/todo-intake/env` via curl — NEVER the claude.ai Notion connector for the core loop.
- API version header `Notion-Version: 2025-09-03` on every call.
- New guardrails (verbatim from spec): NEVER edit the digest zone of a `mirrored` KB; NEVER delete KB content except the 30-entry activity-log trim.
- All existing todo-intake guardrails still apply (no sends, no completes, no deletes/archives).
- Page IDs are created at execution time; each task records them where later tasks expect them (env file keys `NOTION_KB_INDEX_PAGE_ID`, `NOTION_EMMY_KB_PAGE_ID`, `NOTION_COMPOUND_KB_PAGE_ID`).
- Shell snippets assume: `source ~/.config/todo-intake/env` and
  `H=(-H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json")`.

---

### Task 1: Notion scaffolding — index page + two KB pages

**Files:**
- Modify: `~/.config/todo-intake/env` (append three ID lines; file is NOT in git)

**Interfaces:**
- Consumes: existing `NOTION_TOKEN`, To do data source `738b360f-dcb0-4388-80d6-df62ba0a9e00`
- Produces: three Notion pages with known IDs, recorded in the env file as `NOTION_KB_INDEX_PAGE_ID`, `NOTION_EMMY_KB_PAGE_ID`, `NOTION_COMPOUND_KB_PAGE_ID`. Every later task reads these keys.

- [ ] **Step 1: Resolve a parent page for the new pages**

```bash
source ~/.config/todo-intake/env
H=(-H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json")
DB=$(curl -s "https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00" "${H[@]}" | jq -r '.parent.database_id')
curl -s "https://api.notion.com/v1/databases/$DB" "${H[@]}" | jq '.parent'
```

- If `.parent.type == "page_id"` → use that page ID as `PARENT`.
- If `.parent.type == "workspace"` → the API can't create top-level pages. **Gate:** ask Paul to create a page named "Agent KBs" anywhere in Notion, share it with the todo-intake integration, and paste its link; extract the 32-char ID as `PARENT`.

- [ ] **Step 2: Create the three pages**

```bash
for TITLE in "Agent KB index" "Compound KB" "Emmy KB digest"; do
  curl -s -X POST https://api.notion.com/v1/pages "${H[@]}" -d '{
    "parent":{"page_id":"'"$PARENT"'"},
    "properties":{"title":{"title":[{"text":{"content":"'"$TITLE"'"}}]}}}' | jq -r '.id + "  " + "'"$TITLE"'"'
done
```

Record the three IDs as `INDEX_ID`, `COMPOUND_ID`, `EMMY_ID`.

- [ ] **Step 3: Add the two-heading skeleton to both KB pages**

Run once with `<PAGE>` = `$COMPOUND_ID`, once with `<PAGE>` = `$EMMY_ID`:

```bash
curl -s -X PATCH "https://api.notion.com/v1/blocks/<PAGE>/children" "${H[@]}" -d '{
 "children":[
  {"type":"heading_1","heading_1":{"rich_text":[{"type":"text","text":{"content":"Activity log"}}]}},
  {"type":"heading_1","heading_1":{"rich_text":[{"type":"text","text":{"content":"Digest"}}]}}
 ]}'
```

- [ ] **Step 4: Write the index table**

```bash
curl -s -X PATCH "https://api.notion.com/v1/blocks/$INDEX_ID/children" "${H[@]}" -d '{
 "children":[
  {"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Maps a To do Project to its knowledgebase page. Types: agent-owned = the todo agent maintains the Digest. mirrored = the Digest is synced from an external source of truth; the agent must never edit it."}}]}},
  {"type":"table","table":{"table_width":3,"has_column_header":true,"children":[
   {"type":"table_row","table_row":{"cells":[[{"type":"text","text":{"content":"Project"}}],[{"type":"text","text":{"content":"KB page"}}],[{"type":"text","text":{"content":"Type"}}]]}},
   {"type":"table_row","table_row":{"cells":[[{"type":"text","text":{"content":"🏘️ Compound"}}],[{"type":"mention","mention":{"page":{"id":"'"$COMPOUND_ID"'"}}}],[{"type":"text","text":{"content":"agent-owned"}}]]}},
   {"type":"table_row","table_row":{"cells":[[{"type":"text","text":{"content":"🧭 Nava"}}],[{"type":"mention","mention":{"page":{"id":"'"$EMMY_ID"'"}}}],[{"type":"text","text":{"content":"mirrored"}}]]}}
  ]}}
 ]}'
```

- [ ] **Step 5: Verify reads + record IDs**

```bash
curl -s "https://api.notion.com/v1/blocks/$INDEX_ID/children" "${H[@]}" | jq '.results[].type'
# Expected: "paragraph", "table"
cat >> ~/.config/todo-intake/env <<EOF
NOTION_KB_INDEX_PAGE_ID=$INDEX_ID
NOTION_COMPOUND_KB_PAGE_ID=$COMPOUND_ID
NOTION_EMMY_KB_PAGE_ID=$EMMY_ID
EOF
```

No commit (env file is untracked by design; nothing in git changed).

---

### Task 2: Emmy digest sync script

**Files:**
- Create: `~/scripts/sync-emmy-kb-digest.py` (home repo, tracked)

**Interfaces:**
- Consumes: `NOTION_TOKEN` + `NOTION_EMMY_KB_PAGE_ID` from `~/.config/todo-intake/env`; markdown at `~/code/emmy-project-context` (`START-HERE.md`, `domains/_*.md`)
- Produces: `python3 ~/scripts/sync-emmy-kb-digest.py` — idempotent; rewrites everything below the "Digest" heading, preserves the Activity log above it. Task 5 wires this command into `/update`.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Mirror the shared Emmy KB (START-HERE topline + six domain toplines) into
the Notion 'Emmy KB digest' page. Wipe-and-rewrite everything below the
'Digest' heading; the Activity log section above it is preserved. Idempotent."""
import json, os, sys, time, urllib.request, urllib.error

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

kids = children(PAGE)
def heading_text(b):
    t = b["type"]
    if not t.startswith("heading"):
        return ""
    return "".join(x["plain_text"] for x in b[t]["rich_text"]).strip().lower()

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
```

`chmod +x ~/scripts/sync-emmy-kb-digest.py`

- [ ] **Step 2: Run it and verify content landed**

```bash
python3 ~/scripts/sync-emmy-kb-digest.py
source ~/.config/todo-intake/env
H=(-H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03")
curl -s "https://api.notion.com/v1/blocks/$NOTION_EMMY_KB_PAGE_ID/children?page_size=100" "${H[@]}" \
  | jq '[.results[].type] | group_by(.) | map({(.[0]): length}) | add'
```

Expected: 2 `heading_1`, 6 `toggle`, plus paragraphs — and the "Activity log" heading still present.

- [ ] **Step 3: Verify idempotence (run twice, same shape)**

Re-run the script, re-run the jq count. Expected: identical counts, no duplicated toggles.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-emmy-kb-digest.py
git commit -m "Add Emmy KB digest sync script (shared repo -> Notion mirror)"
```

---

### Task 3: Seed the Compound KB from past sessions

**Files:**
- None in git (output is Notion blocks on the Compound KB page)

**Interfaces:**
- Consumes: `NOTION_COMPOUND_KB_PAGE_ID` from the env file; session transcripts under `~/.claude/projects/`
- Produces: a Paul-approved Digest on the Compound KB page.

- [ ] **Step 1: Mine past sessions for house/renovation content**

```bash
grep -l -i -E 'renovation|contractor|kitchen|bathroom|vanity|hvac|plumb|roof|floor plan|compound' \
  ~/.claude/projects/*/*.jsonl 2>/dev/null
```

For each hit, read the first user message and assistant summaries (not whole transcripts) and note facts about the house and renovation work. Also check `~/Documents/Compound - 1st floor*.png` exist and reference them (by name only — images can't sync into a text digest, but the digest should say they exist and where).

- [ ] **Step 2: Draft the digest and gate on Paul's review**

Draft ≤600 words under these headings: **Property overview**, **Renovation status**, **People & contractors**, **Open threads**. Post the draft in chat. **Gate: wait for Paul's approval or edits before writing to Notion.**

- [ ] **Step 3: Write the approved digest to the page**

Append the approved content as paragraph/heading_2 blocks after the "Digest" heading (they land at the page bottom, which is below "Digest" — correct):

```bash
source ~/.config/todo-intake/env
H=(-H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json")
curl -s -X PATCH "https://api.notion.com/v1/blocks/$NOTION_COMPOUND_KB_PAGE_ID/children" "${H[@]}" -d '{
 "children":[
  {"type":"heading_2","heading_2":{"rich_text":[{"type":"text","text":{"content":"Property overview"}}]}},
  {"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"<approved content>"}}]}}
  /* ...one block per section/paragraph of the approved draft... */
 ]}'
```

- [ ] **Step 4: Verify**

`GET /v1/blocks/$NOTION_COMPOUND_KB_PAGE_ID/children` — expect the two headings plus the digest blocks, digest below "Digest".

---

### Task 4: Teach `/todo-intake` to read and write KBs

**Files:**
- Modify: `~/.claude/skills/todo-intake/SKILL.md` (guardrails block ~line 17; after step 4 ~line 98; step 6 ~line 149)

**Interfaces:**
- Consumes: `NOTION_KB_INDEX_PAGE_ID` (env file), page anatomy from Task 1
- Produces: the sweep behavior Task 7 tests; Task 6 ports this same text to the routine prompt.

- [ ] **Step 1: Add two guardrails to "Hard guardrails"**

```markdown
- NEVER edit content under the "Digest" heading of a KB page whose Type in
  the Agent KB index is `mirrored` — it is a synced mirror; edits get
  clobbered and diverge from the source of truth.
- NEVER delete KB page content, except trimming the Activity log to its 30
  newest entries.
```

- [ ] **Step 2: Add section 4b after step 4 (Enrich)**

```markdown
## 4b. Project knowledgebase

The Agent KB index page (`$NOTION_KB_INDEX_PAGE_ID`, from the env file) maps
Projects to KB pages. After the item's Project is known:

1. `GET /v1/blocks/$NOTION_KB_INDEX_PAGE_ID/children`, find the `table`
   block, `GET` its children, and match the item's Project against column 1
   of each row. No matching row → skip this section entirely (the item
   processes exactly as before).
2. A matching row gives the KB page (page mention in column 2) and its Type
   (column 3: `agent-owned` or `mirrored`). `GET` the KB page's children.
   Every KB page has two `heading_1` sections: "Activity log" (newest
   first), then "Digest".
3. Read the Activity log entries (blocks between the two headings) — this
   is what's already in flight for the project; use it to avoid duplicate
   work and to connect the item to ongoing threads.
4. Read the Digest selectively:
   - `agent-owned`: read all digest blocks.
   - `mirrored` (Emmy): always read the top-level paragraphs (the topline);
     of the six domain toggles (Product / Policy / Research / Design /
     Engineering / States), expand (`GET` children) ONLY the one or two
     whose domain the task plausibly touches. Never read all six.
5. Use what you learned in the Context block (step 4) and any drafting
   (step 5).
```

- [ ] **Step 3: Add the write-back bullet to step 6 (File)**

```markdown
- KB write-back (only if the project had a KB row in 4b AND this run
  produced work — a draft, research findings, or a resolved thread):
  1. Insert one activity-log line as a paragraph block directly after the
     "Activity log" heading:
     `PATCH /v1/blocks/<kb_page_id>/children` with
     `{"after":"<activity_heading_block_id>","children":[<paragraph>]}` —
     text: `YYYY-MM-DD — <one line on what was done> (<item title>, <url>)`.
  2. Trim: if more than 30 entries now sit between the two headings, DELETE
     the oldest blocks (the ones nearest the "Digest" heading).
  3. `agent-owned` KBs only: if the task established a durable fact about
     the project (a decision, a purchase, a contractor, a completed step),
     update the matching Digest block (`PATCH` the block) or append a new
     paragraph under "Digest". NEVER do this on a `mirrored` KB.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/todo-intake/SKILL.md
git commit -m "todo-intake: read project KBs in Enrich, write activity log in File"
```

---

### Task 5: Wire harvest + sync into `/update`

**Files:**
- Modify: `~/.claude/commands/update.md` (Phase 2 list, after step 3; file is untracked — no commit)

**Interfaces:**
- Consumes: `python3 ~/scripts/sync-emmy-kb-digest.py` (Task 2), `NOTION_EMMY_KB_PAGE_ID` (env file)
- Produces: Friday loop that closes the Notion → shared-repo → Notion cycle.

- [ ] **Step 1: Insert a new step 4 in Phase 2 (renumber the old step 4 to 5)**

```markdown
4. **Harvest the todo-pipeline activity log.** Read the "Emmy KB digest"
   Notion page's Activity log section (page id: `NOTION_EMMY_KB_PAGE_ID` in
   `~/.config/todo-intake/env`; use the token from the same file via curl,
   not the connector). Entries newer than the last `/update` run are
   candidate contributions: fold any durable decision or finding into step
   3's contribute → distill pass (same approval gate). Ignore pure status
   lines ("drafted email to X") — only durable facts graduate.
5. **List anything deliberately NOT captured** (e.g. working docs) so
   nothing silently drops. Then refresh the Notion mirror:
   `python3 ~/scripts/sync-emmy-kb-digest.py` (required after any
   distillation this run; harmless otherwise).
```

- [ ] **Step 2: Verify the edit reads coherently**

Read Phase 2 top to bottom once; confirm numbering is 1–5 with no orphan references to the old step 4.

---

### Task 6: Update the hourly cloud routine

**Files:**
- Modify: cloud routine `todo-intake-sweep` (`trig_01PB8TRLkwdzw5YuRoxFZKpv`) — via the `schedule` skill, not a file
- Modify: `docs/todo-pipeline/probe-results.md` (append a config-change row)

**Interfaces:**
- Consumes: Task 4's section text; the literal `NOTION_KB_INDEX_PAGE_ID` value from Task 1 (page IDs are not secrets; the token never appears — the routine uses the Notion connector)
- Produces: hourly sweeps with KB behavior on the cloud surface.

- [ ] **Step 1: Fetch the current routine prompt**

Invoke the `schedule` skill to show routine `trig_01PB8TRLkwdzw5YuRoxFZKpv` and capture its current prompt text.

- [ ] **Step 2: Append the KB section and save**

Add Task 4's 4b + write-back text to the routine prompt, adapted for the connector surface: replace every `curl`/`GET /v1/...` instruction with "use the Notion connector tools", replace `$NOTION_KB_INDEX_PAGE_ID` with the literal index page ID, and include both new guardrails verbatim. Save via the `schedule` skill.

- [ ] **Step 3: Manual-fire and verify**

Trigger a manual run (same path as the 2026-08-09 verification). Expected: run completes; if the sweep found no `new` items it must NOT have touched any KB page (check the Emmy digest page's `last_edited_time` is unchanged).

- [ ] **Step 4: Record and commit**

Append to `docs/todo-pipeline/probe-results.md`: date, "routine prompt updated with project-KB enrich/write-back, manual fire verified".

```bash
git add docs/todo-pipeline/probe-results.md
git commit -m "Record cloud-routine KB update verification"
```

---

### Task 7: End-to-end verification + docs

**Files:**
- Modify: `README.md` (How it works step 2 + Contents table)
- Modify: `~/.claude/projects/-Users-paul/memory/project_voice_todo_pipeline.md` (one-line addendum)

**Interfaces:**
- Consumes: everything above.
- Produces: verified pipeline + updated docs.

- [ ] **Step 1: Seed two test items**

```bash
source ~/.config/todo-intake/env
H=(-H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json")
for P in "🏘️ Compound|TEST KB — summarize current renovation status (safe to archive)" \
         "🧭 Nava|TEST KB — outline Emmy UC3 open design questions (safe to archive)"; do
  curl -s -X POST https://api.notion.com/v1/pages "${H[@]}" -d '{
    "parent":{"data_source_id":"738b360f-dcb0-4388-80d6-df62ba0a9e00"},
    "properties":{
      "Task name":{"title":[{"text":{"content":"'"${P#*|}"'"}}]},
      "Project":{"select":{"name":"'"${P%%|*}"'"}},
      "Agent":{"select":{"name":"new"}},
      "Status":{"status":{"name":"to do"}}}}' | jq -r .id
done
```

- [ ] **Step 2: Run the sweep and check the Compound path**

Run `/todo-intake`. Verify: the Compound item's draft/context references digest facts; the Compound KB page gained exactly one activity-log entry between the headings.

- [ ] **Step 3: Check the Nava path — selective read + mirror untouched**

Verify: only relevant domain toggle(s) were expanded during processing (per the sweep's report); the Emmy digest blocks below "Digest" are unedited (compare `last_edited_time` of a digest block before/after); one activity-log entry added above.

- [ ] **Step 4: Check the no-KB path**

Confirm any item whose Project has no index row processed with zero KB reads (sweep report mentions none).

- [ ] **Step 5: Hand test items back to Paul**

Comment "🤖 test item — safe to archive" on both; leave Status/Agent per normal filing rules (guardrails forbid archiving).

- [ ] **Step 6: Update README and memory, commit**

README "How it works" step 2: after "de-dupes, enriches with context" add ", pulls the project's knowledgebase (Notion; see Agent KB index)". Contents table: add row `scripts/sync-emmy-kb-digest.py | Shared Emmy KB → Notion digest mirror`. Memory file: append one line noting the KB layer exists and where the index lives.

```bash
git add README.md
git commit -m "Document per-project KB layer in README"
```
