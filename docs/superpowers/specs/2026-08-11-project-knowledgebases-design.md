# Per-Project Knowledgebases for the To-Do Agent Workflow — Design

**Date:** 2026-08-11
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-08-09-voice-todo-pipeline-design.md`

## Problem

Agents working to-do items (local `/todo-intake` and the hourly cloud routine)
draft and enrich with no project memory. A Compound task should know the
current state of the house and renovations; a Nava task should draw on the
Emmy project context. Today step 4 (Enrich) only searches completed items in
the same Notion database.

## Constraints

- The hourly cloud routine runs in a sandbox: **no local files, no secrets**
  (probe-verified 2026-08-09). It reaches the world only through the
  Notion/Gmail/Slack connectors.
- `paulgehrig/emmy-project-context` is a **private** GitHub repo — not
  fetchable from the cloud routine without embedding a token, which the
  pipeline design forbids.
- The shared repo clone `~/code/emmy-project-context` is the canonical
  published Emmy KB (per `/update` Phase 2; the local `~/Emmy` vault is
  intentionally not kept in sync with it). Nothing in this design makes
  Notion a competing source of truth for Emmy.

## Decision

All KB content lives in **Notion**, reachable identically by both surfaces.

### KB index

One Notion page, **"Agent KB index"**, whose ID is written into the skill and
the routine prompt once. It holds a table:

| Project | KB page | Type |
|---|---|---|
| 🏘️ Compound | Compound KB | `agent-owned` |
| 🧭 Nava | Emmy KB digest | `mirrored` |

Adding a KB for another project (CourtChat, UW, …) = add a row. No prompt
edits, no routine redeploy.

### KB page anatomy — two zones

Every KB page has:

1. **Digest zone** — the curated understanding of the project.
   - `agent-owned` (Compound): the todo agent maintains it. When a task
     resolves with a durable fact ("vanity ordered, arriving ~Sept",
     "contractor X handles electrical"), the agent updates the digest.
   - `mirrored` (Emmy): read-only copy of the shared-repo domain toplines
     (`~/code/emmy-project-context/domains/_*.md`), refreshed by a sync
     script. **The todo agent never edits a mirrored digest** — edits would
     be clobbered on the next sync.
2. **Activity log zone** — agent-appended on every KB-relevant task, both
   types: one line per filed/iterated task, newest first
   (`2026-08-11 — drafted email to plumber re: quote, <link>`). Trimmed to
   the **last 30 entries**. This is what makes the KB compound: the next
   sweep reads it and knows what's already in flight.

For mirrored KBs the activity log is also the bridge back to the source of
truth: the Friday `/update` loop harvests durable items from it as candidate
contributions through the existing Phase 2 contribute → distill flow in
`~/code/emmy-project-context`, then re-syncs the digest.

### Emmy digest structure (token-cost control)

The sync script pushes, from `~/code/emmy-project-context`:

- **Top level:** the repo's `START-HERE.md` topline (~700 tokens).
- **Six toggles**, one per domain (product, policy, research, design,
  engineering, states), each holding that domain's `domains/_*.md` content.

Read rule for the agent: always read the topline when processing a Nava
task; expand a domain toggle only when the task plausibly touches that
domain. Full digest is ~16k tokens; a typical selective read is 1–4k.
Notion's API returns block children on demand, so toggles are the
pay-for-what-you-read boundary.

Mirroring cost is weekly (Friday `/update`), not hourly. Hourly reads happen
only when the sweep actually contains a task whose project has a KB row.

## Sweep changes (todo-intake skill + cloud routine prompt — one redeploy)

- **Step 4 Enrich:** after the item's Project is known, read the KB index. If
  the project has a KB page, read its digest (selectively, per the read rule)
  and activity log; use both when enriching and drafting. No KB row → behave
  exactly as today.
- **Step 6 File:** if the task used a KB, append an activity-log line. If the
  KB is `agent-owned` and the task produced a durable fact, update the digest
  too. Trim the log to 30 entries.
- **New guardrails:**
  - NEVER edit the digest zone of a `mirrored` KB.
  - NEVER delete KB content except the 30-entry log trim.

## `/update` skill changes

One added step in Phase 2: read the Emmy KB activity log in Notion, surface
anything durable as candidate contributions (existing contribute → distill
flow in the shared repo), then run the digest sync script so the mirror
reflects the updated toplines.

## Setup (one-time)

1. Create the Agent KB index page; share with the integration; record its ID
   in the skill and routine prompt.
2. Create the Compound KB page (digest + activity log sections), **seeded by
   mining past Claude Code sessions** for renovation/house discussions; Paul
   reviews the seed before it goes live.
3. Create the Emmy KB digest page; write the sync script (lives in
   `scripts/` in this repo), wire it into the Friday `/update` skill; run it
   once.

## Out of scope (YAGNI)

- KBs for projects other than Compound and Nava (add rows later).
- Any automated sync more frequent than the Friday loop.
- Embedding GitHub access in the cloud routine.
- Vector search / semantic retrieval — the digest + log is small enough to
  read directly.

## Testing

- Seed a test Compound item; verify the sweep reads the Compound KB, uses it
  in the draft, and appends an activity-log line.
- Seed a test Nava item; verify selective toggle reading (topline + one
  domain) and that the mirrored digest is untouched afterward.
- Run the digest sync twice; verify idempotence (no duplicate blocks).
- Verify an item whose project has no KB row processes exactly as before.
- Manual-fire the cloud routine once after the prompt update (same
  verification path as the 2026-08-09 probe).
