# Voice → To-Do Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voice-dictate a to-do on iPhone → cleaned, categorized item lands in the Notion "✅ To do" database → an hourly AI sweep enriches it, drafts email/doc/Slack/research first-passes onto the task page, or files it for manual triage.

**Architecture:** A Siri Shortcut calls the Claude API (Haiku, structured outputs) to clean/categorize the dictation, confirms via editable prompt, then writes to Notion via a plain integration token (never the claude.ai connector — headless-safe by construction). A `/todo-intake` skill sweeps `Agent = new` items; a scheduled cloud routine runs the same sweep hourly. Gmail/Slack draft *objects* are a promotion step from draft text that always lives on the task page.

**Tech Stack:** Apple Shortcuts (iOS/macOS), Claude API (`claude-haiku-4-5`, structured outputs), Notion public API (`Notion-Version: 2025-09-03`), Claude Code skill (`~/.claude/skills/todo-intake/`), Claude Code scheduled routine.

**Spec:** `docs/superpowers/specs/2026-08-09-voice-todo-pipeline-design.md`

## Global Constraints

- Target database: **✅ To do**, data source ID `738b360f-dcb0-4388-80d6-df62ba0a9e00` (database ID `88bb6658-8965-4a87-a7f0-c86067a7ffc2`).
- Paul's Notion user ID (for Assignee): `55e82040-9178-4fe9-844b-1cf2aeda8db1`.
- Capture model: `claude-haiku-4-5` (user-approved in spec — capture must return in ~1s; the sweep itself runs as a normal Claude Code session on the session model).
- Notion API version header: `Notion-Version: 2025-09-03` everywhere.
- `Agent` select values, exactly: `new`, `processed`, `drafted`, `needs input`.
- Project select values, exactly: `🧭 Nava`, `🤖 CourtChat`, `🏠 Home`, `🐺 UW`, `🧠 Civic Insights`, `💡 Projects`, `🏘️ Compound`.
- Secrets live in `~/.config/todo-intake/env` (chmod 600), NEVER committed to git (home repo: do not `git add` anything under `.config/`).
- Hard guardrails (verbatim from spec, apply to every sweep implementation step): never send email/Slack; never complete or delete tasks; never touch items without an `Agent` marker; never re-categorize after first pass; never overwrite a user-set Priority.

---

### Task 1: Secrets + Notion integration token

**Files:**
- Create: `~/.config/todo-intake/env`
- Test: curl against the Notion API

**Interfaces:**
- Produces: env file with `NOTION_TOKEN` and `ANTHROPIC_API_KEY`, sourced by every later task's curl tests. Produces a Notion integration connected to the ✅ To do database.

- [ ] **Step 1: Ask Paul to create the Notion integration (manual gate — notify and wait)**

Paul does this in a browser:
1. Open https://www.notion.so/profile/integrations → "New integration".
2. Name: `todo-intake`. Workspace: Paul's Notion. Type: Internal.
3. Capabilities: Read content, Update content, Insert content. Save, copy the secret (`ntn_...`).
4. Open the ✅ To do database page in Notion → `•••` menu → Connections → add `todo-intake`.

- [ ] **Step 2: Ask Paul for an Anthropic API key**

Paul creates/copies a key at https://platform.claude.com/settings/keys (a dedicated key named `todo-shortcut` is preferred so it can be revoked independently).

- [ ] **Step 3: Write the env file**

```bash
mkdir -p ~/.config/todo-intake
cat > ~/.config/todo-intake/env <<'EOF'
NOTION_TOKEN=ntn_PASTE_HERE
ANTHROPIC_API_KEY=sk-ant-PASTE_HERE
EOF
chmod 600 ~/.config/todo-intake/env
```

Have Paul paste the real values in (or accept them via chat and write them yourself, then remind him they're stored at that path).

- [ ] **Step 4: Verify the Notion token can see the data source**

```bash
source ~/.config/todo-intake/env
curl -s https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00 \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2025-09-03" | jq -r '.title[0].plain_text? // .message'
```

Expected: `To do` (or similar title text). If the output is an `object_not_found` message: the integration isn't connected to the database — redo Step 1.4.

- [ ] **Step 5: Verify the Anthropic key works**

```bash
source ~/.config/todo-intake/env
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":10,"messages":[{"role":"user","content":"say ok"}]}' | jq -r '.content[0].text? // .error.message'
```

Expected: a short text reply. An `authentication_error` means the key is wrong.

- [ ] **Step 6: Commit nothing** — this task produces only the untracked `~/.config/todo-intake/env`. Run `git status --short ~/.config 2>/dev/null | head -1` and confirm no output shows it staged.

---

### Task 2: Notion schema prep (Agent property + Compound project)

**Files:**
- Modify: Notion data source `collection://738b360f-dcb0-4388-80d6-df62ba0a9e00` (schema only, no code files)

**Interfaces:**
- Consumes: Task 1's `NOTION_TOKEN` for verification.
- Produces: `Agent` select property with options `new` / `processed` / `drafted` / `needs input`; new Project option `🏘️ Compound`. Every later task depends on these exact names.

- [ ] **Step 1: Add the `Agent` property and `🏘️ Compound` option**

Preferred: in the Claude Code session, use the Notion MCP tool `notion-update-data-source` on data source `collection://738b360f-dcb0-4388-80d6-df62ba0a9e00` to (a) add a select property named `Agent` with options `new` (color yellow), `processed` (gray), `drafted` (green), `needs input` (red); (b) add option `🏘️ Compound` (color orange) to the existing `Project` select. Do not modify any other property.

Fallback if the MCP tool rejects schema edits: do the same via the public API —

```bash
source ~/.config/todo-intake/env
curl -s -X PATCH https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00 \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" \
  -d '{"properties":{"Agent":{"select":{"options":[{"name":"new","color":"yellow"},{"name":"processed","color":"gray"},{"name":"drafted","color":"green"},{"name":"needs input","color":"red"}]}}}}' | jq '.properties.Agent.select.options | length'
```

Expected: `4`. Then add the Project option the same way (send the full existing `Project` options list plus `{"name":"🏘️ Compound","color":"orange"}` — the API replaces the option list, so fetch current options first with the Task 1 Step 4 call and include all of them).

- [ ] **Step 2: Verify the schema**

```bash
source ~/.config/todo-intake/env
curl -s https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00 \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" \
  | jq '[.properties.Agent.select.options[].name, (.properties.Project.select.options[].name | select(. == "🏘️ Compound"))]'
```

Expected: `["new","processed","drafted","needs input","🏘️ Compound"]`.

- [ ] **Step 3: Round-trip test — create and archive a test page**

```bash
source ~/.config/todo-intake/env
PAGE_ID=$(curl -s https://api.notion.com/v1/pages \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" \
  -d '{
    "parent": {"type":"data_source_id","data_source_id":"738b360f-dcb0-4388-80d6-df62ba0a9e00"},
    "properties": {
      "Task name": {"title":[{"text":{"content":"SCHEMA TEST — safe to delete"}}]},
      "Project": {"select":{"name":"🏘️ Compound"}},
      "Status": {"status":{"name":"to do"}},
      "Agent": {"select":{"name":"new"}},
      "Assignee": {"people":[{"id":"55e82040-9178-4fe9-844b-1cf2aeda8db1"}]}
    }
  }' | jq -r '.id')
echo "created $PAGE_ID"
curl -s -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" \
  -d '{"archived": true}' | jq '.archived'
```

Expected: a page ID printed, then `true`. This exact create payload is what the Shortcut will send (Task 4).

---

### Task 3: Capture prompt + Claude API contract

**Files:**
- Create: `docs/todo-pipeline/capture-system-prompt.txt`
- Create: `docs/todo-pipeline/capture-request-template.json`
- Test: curl with three sample dictations

**Interfaces:**
- Consumes: Task 1's `ANTHROPIC_API_KEY`.
- Produces: the exact system prompt and request body the Shortcut uses. Response JSON shape (guaranteed by structured outputs): `{"title": string, "project": string, "due": string, "summary": string}` — `due` is `YYYY-MM-DD` or `""`; `summary` is `""` when the title captures everything; `project` is always one of the seven Project option strings.

- [ ] **Step 1: Write the system prompt file**

Write `docs/todo-pipeline/capture-system-prompt.txt` with exactly:

```
You convert a voice-dictated to-do into a clean task entry. Today's date is {{DATE}}.

Rules:
- title: rewrite the dictation as a short imperative task title (max ~70 chars). Fix speech-to-text artifacts. Keep names and specifics.
- project: pick exactly one:
  - "🧭 Nava" — Paul's job at Nava PBC: client work, Emmy design system, work meetings, coworkers, HR/benefits.
  - "🤖 CourtChat" — the CourtChat side project: court reminders product, its knowledgebase, pilots, admin panel.
  - "🏠 Home" — household/personal errands: family, house upkeep, appointments, shopping, kids, health.
  - "🐺 UW" — University of Washington related items.
  - "🧠 Civic Insights" — the Civic Insights project.
  - "💡 Projects" — other side projects, ideas, tinkering that fits nowhere above.
  - "🏘️ Compound" — the Compound property: tenants, renovations, financing, utilities, property logistics.
- due: if the dictation states or implies a deadline ("by Friday", "before the 15th", "tomorrow"), resolve it to a YYYY-MM-DD date using today's date. Otherwise "".
- summary: one sentence holding any detail that did not fit in the title (context, names, amounts). "" if the title captures everything.
```

- [ ] **Step 2: Write the request template**

Write `docs/todo-pipeline/capture-request-template.json` with exactly:

```json
{
  "model": "claude-haiku-4-5",
  "max_tokens": 500,
  "system": "SYSTEM_PROMPT_WITH_DATE",
  "messages": [{ "role": "user", "content": "DICTATED_TEXT" }],
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "project": { "type": "string", "enum": ["🧭 Nava", "🤖 CourtChat", "🏠 Home", "🐺 UW", "🧠 Civic Insights", "💡 Projects", "🏘️ Compound"] },
          "due": { "type": "string" },
          "summary": { "type": "string" }
        },
        "required": ["title", "project", "due", "summary"],
        "additionalProperties": false
      }
    }
  }
}
```

- [ ] **Step 3: Test with three sample dictations**

For each of these three inputs, build the request by substituting the system prompt (with today's date) and the dictation, POST to `https://api.anthropic.com/v1/messages` with headers `x-api-key: $ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, `content-type: application/json`, and parse `.content[0].text` as JSON:

1. `"um remind me to email Sarah about the the Emmy design review notes by Friday"` → expect project `🧭 Nava`, a `due` date that is the upcoming Friday, title mentioning emailing Sarah.
2. `"call the plumber about the water heater at the compound"` → expect project `🏘️ Compound`, `due` = `""`.
3. `"look into whether court chat should support text message replies"` → expect project `🤖 CourtChat`.

```bash
source ~/.config/todo-intake/env
SYS=$(sed "s/{{DATE}}/$(date +%Y-%m-%d)/" docs/todo-pipeline/capture-system-prompt.txt | jq -Rs .)
BODY=$(jq --argjson sys "$SYS" --arg msg "um remind me to email Sarah about the the Emmy design review notes by Friday" \
  '.system=$sys | .messages[0].content=$msg' docs/todo-pipeline/capture-request-template.json)
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d "$BODY" | jq -r '.content[0].text' | jq .
```

Expected for input 1 (dates vary): `{"title":"Email Sarah the Emmy design review notes","project":"🧭 Nava","due":"2026-08-14","summary":""}` — assert it parses as JSON, `project` is the expected value, and `due` matches `^\d{4}-\d{2}-\d{2}$` or `""`. Repeat for inputs 2 and 3. If a categorization is wrong, adjust the project descriptions in the prompt file and re-run.

- [ ] **Step 4: Commit**

```bash
git add docs/todo-pipeline/capture-system-prompt.txt docs/todo-pipeline/capture-request-template.json
git commit -m "Add voice-capture prompt and Claude API contract for todo pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Siri Shortcut ("Add To-Do")

**Files:**
- Create: `docs/todo-pipeline/shortcut-build-guide.md` (step-by-step build instructions Paul follows in the Shortcuts app)

**Interfaces:**
- Consumes: Task 3's request template + system prompt (pasted into the Shortcut), Task 1's two secrets (pasted into Shortcut Text actions), Task 2's schema.
- Produces: a working Shortcut that creates pages with `Agent = new` — the trigger for Task 5's sweep.

- [ ] **Step 1: Write the build guide**

Write `docs/todo-pipeline/shortcut-build-guide.md` describing this exact action sequence (Shortcuts app, iPhone or Mac — it syncs via iCloud). Include the full system prompt text, both request bodies, and both URLs inline so Paul never has to leave the guide:

1. **New Shortcut** named `Add To-Do`. Enable "Show in Share Sheet" off; add to Siri with phrase "Add to-do".
2. **Dictate text** action (language English). Output: `Dictated Text`.
3. **Text** action holding the Anthropic key (from Task 1). **Text** action holding the Notion token.
4. **Current Date** action → **Format Date** with custom format `yyyy-MM-dd` → output `Today`.
5. **Text** action = the full system prompt from `capture-system-prompt.txt`, with `{{DATE}}` replaced by the `Today` variable (insert the variable inline).
6. **Get contents of URL** #1 — URL `https://api.anthropic.com/v1/messages`, Method POST, Headers: `x-api-key` = key variable, `anthropic-version` = `2023-06-01`, `content-type` = `application/json`. Request Body: JSON matching `capture-request-template.json`, with `system` = the prompt Text variable and the message content = `Dictated Text`. (In Shortcuts, build the body as a Dictionary: `model`, `max_tokens`, `system`, `messages` (array of one dictionary), `output_config` (nested dictionary exactly as in the template).)
7. **Get dictionary from input** → **Get dictionary value** `content` → item 1 → `text` → **Get dictionary from input** again (the structured-outputs JSON) → read `title`, `project`, `due`, `summary` into variables.
8. **If** [Dictionary has any value — i.e., step 7 succeeded]:
   a. **Show Alert / Speak Text** (when run from Siri, Siri reads the result automatically as the prompt): use **Ask for Input** (Text) with prompt `Filed under [project]:` and **Default Answer = [title]** — this is the editable confirm; Paul edits by keyboard or taps Done. Output: `Final Title`.
   b. **Get contents of URL** #2 — URL `https://api.notion.com/v1/pages`, POST, Headers: `Authorization` = `Bearer ` + token variable, `Notion-Version` = `2025-09-03`, `content-type` = `application/json`. Body (Dictionary): `parent` = `{"type":"data_source_id","data_source_id":"738b360f-dcb0-4388-80d6-df62ba0a9e00"}`; `properties` = the Task 2 Step 3 payload shape with `Task name` title = `Final Title`, `Project` select name = `project`, `Status` status name = `to do`, `Agent` select name = `new`, `Assignee` people = `[{"id":"55e82040-9178-4fe9-844b-1cf2aeda8db1"}]`, `Summary` rich_text = `summary`; nested **If** `due` is not `""` → also add `Due` = `{"date":{"start":[due]}}`.
   c. **Show notification**: `Added: [Final Title] → [project]`.
9. **Otherwise** (Claude call failed — the fallback path):
   a. **Get contents of URL** — same Notion POST but `Task name` = raw `Dictated Text`, no Project, no Due, `Status` = `to do`, `Agent` = `new`, `Assignee` as above.
   b. **Show notification**: `Saved raw (cleanup queued): [Dictated Text]`.

Also include in the guide: where each secret goes, and a warning that editing the Shortcut later must not reorder the If/Otherwise branches.

- [ ] **Step 2: Paul builds the Shortcut (manual gate — notify and wait)**

Paul follows the guide in the Shortcuts app. Offer to walk through it action-by-action in chat if anything doesn't match the guide.

- [ ] **Step 3: End-to-end test — happy path**

Paul runs "Hey Siri, add to-do" and dictates: *"pick up the dry cleaning tomorrow"*. Then verify from the session:

```bash
source ~/.config/todo-intake/env
curl -s -X POST https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00/query \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" \
  -d '{"filter":{"property":"Agent","select":{"equals":"new"}}}' \
  | jq '.results[] | {title: .properties["Task name"].title[0].plain_text, project: .properties.Project.select.name, due: .properties.Due.date.start, agent: .properties.Agent.select.name}'
```

Expected: one result, project `🏠 Home`, `due` = tomorrow's date, `agent` = `new`.

- [ ] **Step 4: End-to-end test — fallback path**

Temporarily break the Anthropic key in the Shortcut (add an `x` to the key Text action), run the Shortcut with any dictation, confirm the raw item appears in Notion with `Agent = new` and no Project (re-run the Step 3 query). Restore the key. Leave both test items in place — they're seed data for Task 5.

- [ ] **Step 5: Commit**

```bash
git add docs/todo-pipeline/shortcut-build-guide.md
git commit -m "Add Siri Shortcut build guide for voice to-do capture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `/todo-intake` skill (the sweep)

**Files:**
- Create: `~/.claude/skills/todo-intake/SKILL.md`

**Interfaces:**
- Consumes: `~/.config/todo-intake/env` (Notion via token/curl — never the claude.ai Notion connector for the core loop), items with `Agent = new`.
- Produces: processed items (`Agent` ∈ `processed`/`drafted`/`needs input`), draft text on task pages, Gmail/Slack draft objects when connectors are reachable. Task 6's routine invokes this same skill.

- [ ] **Step 1: Write the skill**

Write `~/.claude/skills/todo-intake/SKILL.md` with exactly this content:

```markdown
---
name: todo-intake
description: Sweep the Notion "To do" database for voice-captured items (Agent = new), clean up, enrich with context, draft first-passes (email/doc/Slack/research), and file the rest for triage. Use when the user runs /todo-intake or asks to process the to-do inbox.
---

# To-Do Intake Sweep

Processes unswept items in the ✅ To do database. All Notion reads/writes use
the integration token via curl (headless-safe) — NEVER the claude.ai Notion
connector for the core loop. Load credentials first:

    source ~/.config/todo-intake/env

Data source ID: `738b360f-dcb0-4388-80d6-df62ba0a9e00`. API version header:
`Notion-Version: 2025-09-03` on every call.

## Hard guardrails (non-negotiable)

- NEVER send an email or Slack message. Drafts only.
- NEVER set Status to complete/archived; never delete or archive pages.
- NEVER touch a page whose `Agent` property is empty.
- NEVER change `Project` on an item whose Agent status is not `new`
  (user corrections stick).
- NEVER overwrite a non-empty `Priority`.

## 1. Pull

Query for work:

    curl -s -X POST https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00/query \
      -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" \
      -H "Content-Type: application/json" \
      -d '{"filter":{"or":[
            {"property":"Agent","select":{"equals":"new"}},
            {"property":"Agent","select":{"equals":"needs input"}}
          ]}}'

- `new` items: full processing (steps 2–6).
- `needs input` items: fetch the page body (GET /v1/blocks/{page_id}/children).
  If Paul has replied below the questions, resume processing with his answer;
  otherwise skip.

## 2. Clean up (raw-fallback items only)

An item with no `Project` came through the Shortcut's fallback path. Rewrite
the title (imperative, ~70 chars, fix dictation artifacts), pick the Project
(options: 🧭 Nava, 🤖 CourtChat, 🏠 Home, 🐺 UW, 🧠 Civic Insights,
💡 Projects, 🏘️ Compound), parse any spoken due date, and PATCH the page
properties.

## 3. Dupe check

Compare the item's title against other open items (Status `to do`/`later`/
`in progress`) pulled in the same query session. If a likely duplicate exists,
append a paragraph block to the page: "⚠️ Possible duplicate of: <title>
(<url>)". Never delete or archive either item.

## 4. Enrich

Search for related history: completed items in this database with similar
topics (query with a `Status = complete` filter plus title keywords), plus
anything relevant you know from memory/prior sessions. If something useful
turns up, append a short "Context" paragraph block (2–3 sentences max, with
links) to the page. No history found = no block; don't pad.

## 5. Delegate (first-pass work)

Match the item against these shapes; if none fit, it's non-delegable.

- **Email** ("email/reply to/follow up with <person> about X"):
  write the complete email (subject + body) into a toggle block titled
  "📧 Draft email" on the page. Then PROMOTION: if the Gmail connector is
  available in this session, also create a real Gmail draft and link it in
  the toggle. If not, leave the text — the next interactive run promotes it.
- **Doc/content** ("write up/draft/outline/plan X"): draft the content as a
  child page of the task titled "Draft: <task title>".
- **Research** ("look into/compare/find out X"): do web research; append a
  toggle block "🔎 Research findings" with a short summary and source links.
- **Slack** ("tell/ask/ping <person> on Slack about X"): write the message
  into a toggle block "💬 Draft Slack message". Promotion when the Slack
  connector is available: create a Slack draft via slack_send_message_draft
  and note it in the toggle.

Also promote any *previously drafted* items: query `Agent = drafted`, and for
pages whose draft toggle says "not yet promoted", create the Gmail/Slack draft
object now if connectors are available.

## 6. File

- Set `Priority` (1–10) only if empty: 8–10 due within 3 days or urgent
  wording; 5–7 due this month or clearly important; 1–4 someday/nice-to-have.
- Set `Agent`: `drafted` if step 5 produced anything, else `processed`.
- Ambiguous item (can't categorize, or intent unclear): append 1–2 short
  questions as a paragraph block, set `Agent` = `needs input`. Ask directly
  in chat too if Paul is in the session.
- Only flip `Agent` after all of the item's processing succeeded — a crashed
  run must leave the item `new` so the next run retries it.

## 7. Report

End with a short summary: items processed, drafts created (with links),
anything waiting on Paul. Nothing else — no process narration.
```

- [ ] **Step 2: Seed test items — one per delegation shape**

Paul dictates via the Shortcut (or create via curl with `Agent = new` using the Task 2 Step 3 payload) five items:
1. "Email Mike about rescheduling the Compound insurance walkthrough"
2. "Draft an outline for the Emmy onboarding doc"
3. "Look into whether Notion supports recurring tasks natively now"
4. "Ask Dana on Slack about the CourtChat pilot timeline"
5. "Buy new furnace filters" (plain filing — no delegation expected)

- [ ] **Step 3: Run the sweep interactively**

Run `/todo-intake` in a Claude Code session. Watch it process all five.

- [ ] **Step 4: Verify results**

Re-run the Task 4 Step 3 query with filter `Agent = new` → expected: `[]` (empty). Query `Agent = drafted` → expected: items 1–4. Query `Agent = processed` → expected: item 5, with a Priority set. Open one drafted page in Notion and confirm the draft toggle reads sensibly. Confirm no email or Slack message was actually sent.

- [ ] **Step 5: Fix judgment issues and re-test**

If any item was mis-handled (wrong shape match, draft quality, guardrail violation), edit `SKILL.md`, reset that item's `Agent` to `new` via curl, and re-run. Repeat until all five pass.

- [ ] **Step 6: Commit**

The skill lives at `~/.claude/skills/todo-intake/SKILL.md`, inside the home git repo:

```bash
git add .claude/skills/todo-intake/SKILL.md
git commit -m "Add /todo-intake sweep skill for voice to-do pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Probe scheduled-run capabilities

**Files:**
- Create: `docs/todo-pipeline/probe-results.md`

**Interfaces:**
- Consumes: Task 1's env file.
- Produces: verified facts about what a scheduled cloud routine can reach — determines Task 7's promotion behavior and secret-delivery mechanism.

- [ ] **Step 1: Create a one-shot probe routine**

Use the `schedule` skill to create a one-time scheduled run (~5 minutes out) with this prompt:

> Probe run — report only, change nothing. (1) Try reading `~/.config/todo-intake/env` — report whether the file exists in your environment. (2) Try one Notion claude.ai-connector call (`notion-fetch` on `self`) — report success or the exact error. (3) Check whether Gmail connector tools are available (list tool names containing "Gmail") — report. (4) Check whether Slack connector tools are available — report. (5) If the env file existed, curl `https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00` with the token and report the HTTP status. Output a 5-line report, one finding per line.

- [ ] **Step 2: Collect results**

After the run fires, read its output and write `docs/todo-pipeline/probe-results.md` recording: env-file reachable yes/no; Notion connector yes/no; Gmail connector yes/no; Slack connector yes/no; Notion token path yes/no; date of probe.

- [ ] **Step 3: Decide Task 7 shape**

Apply this decision table and record the choice in `probe-results.md`:
- Env file + token path work → routine runs the full core sweep. If not (routines may run in a cloud sandbox without local files), the token must reach the routine another way. Inlining the token into the routine's prompt is NOT acceptable (prompts are stored and readable). Acceptable options: a secrets mechanism if the schedule skill supports one, or scoping Task 7 to notify-only with `/todo-intake` as the sole processor. Record which.
- Gmail/Slack connectors reachable → routine also promotes drafts. Otherwise promotion stays interactive-only.

- [ ] **Step 4: Commit**

```bash
git add docs/todo-pipeline/probe-results.md
git commit -m "Record scheduled-run capability probe results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Hourly cloud routine

**Files:**
- Modify: `docs/todo-pipeline/probe-results.md` (append final routine config)

**Interfaces:**
- Consumes: Task 5's skill logic, Task 6's probe decision.
- Produces: an hourly scheduled sweep, 8am–10pm local time.

- [ ] **Step 1: Create the routine (shape per Task 6 decision)**

Use the `schedule` skill to create a routine, cron `0 8-22 * * *` (hourly, 8:00–22:00), named `todo-intake-sweep`. Prompt, if the probe showed full capability:

> Run the to-do intake sweep exactly as specified in the skill at `~/.claude/skills/todo-intake/SKILL.md`. Follow its hard guardrails without exception. If there are no items with Agent = new or needs input, and no unpromoted drafts, end silently with "nothing to process".

If the probe showed the env file is NOT reachable in scheduled runs: create the routine as notify-only instead — its prompt checks nothing and simply reminds; skip to Step 3 and record that `/todo-intake` is the sole processor (Paul runs it at his desk; revisit when routine secrets are supported).

- [ ] **Step 2: Verify one scheduled run end-to-end**

Dictate one fresh test item via the Shortcut ("test item for the scheduled sweep, safe to archive"). Wait for the next scheduled firing (or trigger a manual run if the schedule skill supports it). Then verify via the Task 4 Step 3 query that the item's `Agent` is no longer `new`, and read the run's output log.

- [ ] **Step 3: Record the final configuration**

Append to `docs/todo-pipeline/probe-results.md`: routine name, schedule, which mode (full sweep vs notify-only), and the date verified. Commit:

```bash
git add docs/todo-pipeline/probe-results.md
git commit -m "Configure hourly todo-intake routine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Cleanup**

Archive the test items created during Tasks 4–7 (via curl PATCH `"archived": true`, or leave for Paul to triage — ask him which). Confirm with Paul that the pipeline is live and hand over: the Shortcut phrase ("Hey Siri, add to-do"), the `/todo-intake` command, and where drafts land.
