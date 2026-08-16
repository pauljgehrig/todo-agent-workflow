# To-Do Capture Endpoint — Design Spec

**Date:** 2026-08-16
**Status:** SHIPPED 2026-08-16 — deployed as Val `pauljgehrig/todo-capture`
(`https://pjg-todo-capture.val.run`, routes `/parse` + `/save`); thin Shortcut
rebuilt and verified end-to-end. See `endpoint/SHORTCUT.md` for the as-built flow
and deploy gotchas.

## Problem

The voice→to-do capture logic lives inside an Apple Shortcut (Dictate → Haiku
parse → build Notion JSON → write). Shortcuts is brittle and undebuggable:
silent failures (mis-picked variable pills, empty-string `due` producing
`{"start":""}` which Notion rejects with a 400 the Shortcut swallows), no
usable undo, no source control, no logs. A single wrong pill or an AI response
with no due date makes the whole capture silently no-op.

## Goal

Move all heavy lifting out of Shortcuts into a small, debuggable HTTP service.
Keep the Shortcut as a thin launcher (dictation + trigger + confirm), because
Shortcuts is genuinely good at fast, voice-triggered launch on both iPhone and
Mac. Preserve the existing behaviors the user values: an editable title-confirm
step, and "fail loud, save nothing" so the board stays clean.

## Non-goals

- No change to downstream: items still land as `Agent = new` and are enriched
  by the `/todo-intake` sweep + hourly cloud routine, unchanged.
- No queue, database, retry framework, or auth beyond a shared secret. One file.

## Architecture

Three components, each one job:

```
 iPhone / Mac Shortcut                 Val Town service (one TS file)
 ─────────────────────                 ──────────────────────────────
 1. Dictate Text
 2. POST {text} ──────────────────▶    POST /parse  → Anthropic (Haiku, structured output)
 3. Ask for Input (edit title,   ◀───  returns {title, project, due, summary}
    default = returned title)
 4. POST {title,project,due,summary} ▶ POST /save   → Notion create page
 5. Show Notification ◀──────────────  returns {ok, message}
```

- **Trigger:** both iPhone and Mac → the service must be internet-reachable, so
  a Mac-local script is out. Hosted endpoint required.
- **Host:** Val Town — single TypeScript file, web editor, built-in env secrets,
  live per-request logs, instant redeploy. Chosen for debuggability.

### Component 1 — Shortcut (launcher only, ~6 actions)

1. **Dictate Text** → `DictatedText`
2. **Get Contents of URL** — `POST <valtown-url>/parse`, header
   `x-todo-secret: <shared secret>`, JSON body `{"text": DictatedText}`.
   → returns `{title, project, due, summary}`.
3. Parse the four fields into named variables (`vTitle`, `vProject`, `vDue`,
   `vSummary`) via Get Dictionary Value + Set Variable pairs.
4. **Ask for Input** (Text) — prompt `Filed under [vProject]:`, default answer
   `[vTitle]` → `FinalTitle`. (Only the title is editable; project/due/summary
   pass through.)
5. **Get Contents of URL** — `POST <valtown-url>/save`, same secret header, JSON
   body `{"title": FinalTitle, "project": vProject, "due": vDue,
   "summary": vSummary}`. → returns `{ok, message}`.
6. **Get Dictionary Value** `message` → **Show Notification**.

No JSON assembly, no `If` blocks, no due-date logic, no Notion body in the
Shortcut. The brittle logic is gone.

### Component 2 — Val Town service (the brains)

Single TS module exporting an HTTP handler that routes on path:

**`POST /parse`**
1. Reject if `x-todo-secret` header ≠ `TODO_SHARED_SECRET` (401).
2. Call Anthropic Messages API: model `claude-haiku-4-5`, structured output
   (`output_config.format` json_schema) with the existing system prompt and the
   `{title, project, due, summary}` schema (project enum = the 7 project options).
3. Return `{title, project, due, summary}` as JSON. Do **not** touch Notion.
4. On Anthropic error or malformed output → HTTP 502 `{ok:false, message}`.

**`POST /save`**
1. Reject if secret header mismatches (401).
2. Validate: `title` non-empty; `project` ∈ the 7 options (else default to
   `💡 Projects` or 400 — decide in plan); **`due` empty/blank → emit
   `date: null`, else `{"start": due}`** (the empty-string bug fix).
3. `POST https://api.notion.com/v1/pages` (Notion-Version `2025-09-03`) to data
   source `738b360f-dcb0-4388-80d6-df62ba0a9e00` with properties: `Task name`
   (title), `Project`, `Status` = "to do", `Agent` = "new", `Assignee` (Paul's
   id), `Summary`, `Due`.
4. On success → `{ok:true, message:"Added: <title> → <project>"}`.
   On Notion error → HTTP 502 `{ok:false, message:"<Notion error message>"}`.

**Secrets** (Val Town env vars): `ANTHROPIC_API_KEY`, `NOTION_TOKEN`,
`TODO_SHARED_SECRET`. Only the shared secret + URL live in the Shortcut.

### Component 3 — Repo source of truth

The Val Town TS lives in the repo (`endpoint/todo-capture.ts` or similar) as the
canonical, diffable source. Val Town runs a copy; repo is the version-controlled
original (fixes the "no source control" pain). Plan will decide sync method
(paste vs Val Town git).

## Data flow

Shortcut → HTTPS `/parse` → Anthropic → back to Shortcut → user edits title →
HTTPS `/save` → Notion → message back to Shortcut notification.

## Error handling

- Every failure returns a non-2xx with a human `message`; the Shortcut shows it.
  No silent no-ops — the opposite of today.
- `/parse` failure → save nothing (board stays clean).
- Server-side validation catches the empty-`due` and out-of-enum-project cases
  before they reach Notion.
- Val Town logs every request (input + outcome) for debugging.

## Testing

A repo test script `curl`s the deployed endpoint with fixtures and asserts
outcomes (then archives the test pages via the Notion API):
- dateless task → lands with `Due = null` (regression guard for the original bug)
- dated task ("… tomorrow") → lands with correct ISO date
- each of the 7 projects → correct select value
- title containing a double quote → lands (JSON-safe)
- missing/invalid secret → 401, nothing written

## Rollout

1. Create the Val Town service, set the three env secrets.
2. Rebuild the Shortcut to the 6-action launcher above.
3. Run the test fixtures against the live endpoint.
4. Fire one real dictation from phone and one from Mac; confirm both land.
5. Keep the old Shortcut logic disabled/archived until the new one is verified.

## Open items for the plan

- Val Town account access + the deployed URL (needed to set secrets and test).
- Exact repo path for the TS source and the test script.
- Out-of-enum project handling: default vs. reject.
