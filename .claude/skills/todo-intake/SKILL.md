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

## 2. Clean up (unfiled items only)

The Shortcut always files items, so an `Agent = new` item with no `Project`
was created by hand in Notion and opted into the pipeline. Rewrite
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
