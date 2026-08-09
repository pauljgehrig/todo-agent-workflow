# Voice → To-Do Pipeline — Design

**Date:** 2026-08-09
**Status:** Approved in brainstorming session; ready for implementation planning

> **Amendment (2026-08-09, during build):** the raw-dump fallback path was
> removed at Paul's request. If the Claude capture call fails, the Shortcut
> errors visibly and saves nothing — keeping the board 100% clean/categorized
> and the sweep free of cleanup work. Re-dictate when the API is back.

## Purpose

Dictate a to-do from the phone by voice, have it land clean and correctly
categorized in Notion, and have an AI agent take a first pass at anything it
can (drafts, research, context) — leaving everything else correctly filed for
manual triage.

## Decisions (settled during brainstorming)

- **Central home:** the existing **✅ To do** database
  (`collection://738b360f-dcb0-4388-80d6-df62ba0a9e00`) becomes the single
  home for all new to-dos.
- **Old boards:** Compounder to-dos and CourtChat Tasks are kept but receive
  no new items; they wind down naturally. The existing `courtchat-tasks`
  skill/workflow is untouched.
- **Capture:** iPhone Siri Shortcut with editable voice confirmation
  (option C — speak, hear it back, correct by voice or keyboard).
- **Processing:** scheduled Claude cloud routine (~hourly, waking hours) +
  `/todo-intake` slash command running identical logic on demand.
- **Connector independence:** all Notion reads/writes use a plain Notion
  integration token (public API), never the claude.ai connector — the core
  pipeline works in any headless context by construction.
- **Delegation output:** draft text always lands on the Notion task page;
  creating real Gmail/Slack draft objects is a cheap "promotion" step done
  wherever connectors are available.

## Architecture

```
Voice → Siri Shortcut
          ├─ Claude API (Haiku): clean title, pick Project, parse due date
          ├─ Editable confirm (Siri reads back; keyboard or voice correction)
          ├─ Notion API (token): create page in ✅ To do, Agent = new
          └─ fallback: API failure → write raw dictation, Agent = new

Hourly cloud routine  ─┐
/todo-intake command  ─┴─ Sweep:
          ├─ query Agent = new (+ answered "needs input" items)
          ├─ clean up raw-fallback items
          ├─ enrich: related history from completed tasks + workspace search
          ├─ delegate: email / doc / research / Slack draft text → task page
          ├─ promote drafts to Gmail/Slack draft objects (if connectors reachable;
          │   otherwise next /todo-intake run promotes them)
          ├─ set Priority only if empty
          └─ set Agent = processed | drafted | needs input
```

## Components

### 1. Siri Shortcut ("Add To-Do")

1. Capture dictation as text.
2. One Claude API call (Haiku; compact prompt listing Projects: Nava,
   CourtChat, Home, UW, Civic Insights, Projects, Compound) → cleaned title,
   Project, optional due date, one-line Summary preserving overflow detail.
3. Confirmation screen: editable text field pre-filled with cleaned title
   (Siri speaks it back on voice invocation); Project shown and correctable.
4. Write to ✅ To do via Notion API token: Status `to do`, Project, Due,
   Summary, Assignee = Paul, `Agent = new`.
5. Fallback: on API failure/timeout, write raw dictation with `Agent = new`.
   Capture never fails silently.

Secrets stored in the Shortcut: Anthropic API key, Notion integration token.

### 2. Notion changes (✅ To do)

- New Project option: `🏘️ Compound`.
- New select property **`Agent`**:
  - `new` — captured, unswept
  - `processed` — enriched/filed; nothing delegable
  - `drafted` — first-pass artifact awaiting review
  - `needs input` — agent question on the task page
  - *(empty)* — hand-created items; opt in by setting `new`
- Agent output (context notes, research, draft text, links to promoted
  drafts) lives in the task page body — long content behind a toggle or
  child page. Properties stay clean.
- Optional later polish: a "Needs my input" view on `Agent = drafted / needs input`.

### 3. Sweep agent (cloud routine + /todo-intake)

Per run:
1. Query for `Agent = new`, plus `needs input` items with new replies.
2. Clean up raw-fallback items (the cleanup they missed at capture).
3. Enrich with related history (completed tasks, workspace search, memory)
   as a short context note on the page.
4. Delegate where the item matches a shape:
   - **Email** → full draft text on the page; promote to Gmail draft.
   - **Doc/content** → draft as child page.
   - **Research** → findings summary with sources.
   - **Slack** → message draft text on the page; promote to Slack draft.
5. Non-delegable items → `Agent = processed`, Priority suggested if empty.
6. Ambiguous items → 1–2 short questions on the page, `Agent = needs input`.

**Hard guardrails:** never send email/Slack; never complete or delete tasks;
never touch items without an `Agent` marker; never re-categorize after first
pass (user corrections stick); never overwrite a user-set Priority.

## Edge cases

- **Duplicates:** sweep flags suspected dupes (similar open titles) on the
  page; never auto-deletes.
- **Sweep crash:** `Agent` flips from `new` only after processing completes;
  failed runs retry next hour. Re-processing is idempotent/harmless.
- **CourtChat items:** filed under Project 🤖 CourtChat in To do; mirroring
  to the CourtChat Tasks board is a possible follow-up, not in scope.

## Rollout (each step independently usable)

1. **Step-zero probe:** throwaway scheduled routine verifying what headless
   runs can reach (Notion connector, Gmail connector, Notion token path).
2. **Notion prep:** `Agent` property, `🏘️ Compound` option, integration token.
3. **Shortcut:** build + use for a few days (clean voice capture stands alone).
4. **`/todo-intake`:** sweep logic run interactively first, judgment corrected live.
5. **Cloud routine:** schedule the proven logic hourly; promotion behavior
   per probe results.

**Testing:** a handful of real dictated items per step; before scheduling,
one deliberate test item per delegation type (email, doc, research, Slack,
plain filing).

## Out of scope

- Migrating existing Compounder / CourtChat items.
- Auto-sending anything, anywhere.
- Per-item event triggering (webhooks) — hourly batch is the design.
- Changes to the `courtchat-tasks` skill.

> **Amendment 2 (2026-08-09, post-launch):** conversation with the agent moved
> from page-body text to Notion **comment threads** (questions, dupe warnings,
> and draft-revision feedback; agent comments prefixed 🤖 since cloud-routine
> comments are authored under Paul's OAuth identity). Drafted items now support
> an iterate loop: Paul comments feedback → sweep revises the draft (and the
> promoted Gmail draft) → replies in-thread. Status mirroring added: Agent
> drafted/needs-input ⇒ Status "in progress" (only from "to do"), resolution to
> processed ⇒ back to "to do".
