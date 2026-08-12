---
name: todo-intake
description: Sweep the Notion "To do" database for voice-captured items (Agent = new), clean up, enrich with context, draft first-passes (email/doc/Slack/research), and iterate on drafts via comment threads. Use when the user runs /todo-intake or asks to process the to-do inbox.
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
- NEVER overwrite a Status Paul set by hand — the only allowed transitions are
  `to do → in progress` (when taking an item) and `in progress → to do` (when
  handing it back), per Status mirroring below.
- NEVER edit content under the "Digest" heading of a KB page whose Type in
  the Agent KB index is `mirrored` — it is a synced mirror; edits get
  clobbered and diverge from the source of truth.
- NEVER delete KB page content, except trimming the Activity log to its 30
  newest entries.

## Communication protocol: comments, not body text

The page BODY holds only work product (draft toggles, context blocks).
All conversation with Paul happens in the page's COMMENT thread:

- Questions (ambiguous items), dupe warnings, and "here's what I did" notices
  are posted as comments: `POST /v1/comments` with
  `{"parent":{"page_id":...},"rich_text":[...]}`.
- Read a thread: `GET /v1/comments?block_id=<page_id>`.
- **Every agent comment starts with 🤖** (cloud-routine comments are authored
  under Paul's OAuth identity, so the prefix — not the author field — is what
  distinguishes agent from human).
- **Turn heuristic:** if the newest comment on an item does NOT start with 🤖,
  Paul has spoken and the agent owes a response. If it starts with 🤖 (or there
  are no comments), the agent is waiting and must not re-process the item.

## Status mirroring

The Status property reflects who has the ball:

- When setting `Agent = drafted` or `needs input` → also set
  `Status = in progress`, but ONLY if the current Status is `to do`.
- When a `needs input` item resolves to `processed` (nothing to draft) → set
  `Status = to do`, but ONLY if the current Status is `in progress`.
- Any other Status value was chosen by Paul — leave it alone.

## 1. Pull

Query for actionable work:

    curl -s -X POST https://api.notion.com/v1/data_sources/738b360f-dcb0-4388-80d6-df62ba0a9e00/query \
      -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" \
      -H "Content-Type: application/json" \
      -d '{"filter":{"or":[
            {"property":"Agent","select":{"equals":"new"}},
            {"property":"Agent","select":{"equals":"needs input"}},
            {"property":"Agent","select":{"equals":"drafted"}}
          ]}}'

- `new` items: full processing (steps 2–6).
- `needs input` items: fetch the comment thread. Newest comment from Paul
  (no 🤖 prefix) → resume processing with his answer, then reply 🤖 with what
  you did. Newest comment is 🤖 → skip, still waiting.
- `drafted` items: fetch the comment thread. Newest comment from Paul →
  treat it as revision feedback (step 5b). Newest is 🤖 or no comments → only
  check draft promotion (step 5c).

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
post a comment: "🤖 Possible duplicate of: <title> (<url>)". Never delete or
archive either item.

## 4. Enrich

Search for related history: completed items in this database with similar
topics (query with a `Status = complete` filter plus title keywords), plus
anything relevant you know from memory/prior sessions. If something useful
turns up, append a short "Context" paragraph block (2–3 sentences max, with
links) to the page body. No history found = no block; don't pad.

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

## 5. Delegate (first-pass work)

### 5a. New items — match against these shapes; none fit = non-delegable.

- **Email** ("email/reply to/follow up with <person> about X"):
  write the complete email (subject + body) into a toggle block titled
  "📧 Draft email" on the page. PROMOTION: if the Gmail connector is
  available in this session, also create a real Gmail draft (recipient blank
  unless the address is certain) and note it in the toggle. If not, note
  "not yet promoted" — the next capable run promotes it.
- **Doc/content** ("write up/draft/outline/plan X"): draft the content
  inside a toggle block "📄 Draft: <topic>" ON THE TASK PAGE — never a child
  page or separate document. Structure the toggle's children as real blocks
  (headings, bullets, paragraphs), one block per section, so Paul can anchor
  an inline comment on exactly the section that needs revision.
- **Research** ("look into/compare/find out X"): do web research; append a
  toggle block "🔎 Research findings" with a short summary and source links.
- **Slack** ("tell/ask/ping <person> on Slack about X"): write the message
  into a toggle block "💬 Draft Slack message". Promotion when the Slack
  connector is available AND the person exists in the workspace: create a
  Slack draft via slack_send_message_draft and note it; otherwise note why not.

### 5b. Drafted items with Paul feedback (newest comment lacks 🤖)

Feedback can be page-level OR anchored to a specific block inside the draft
toggle. For each drafted item: fetch the page's blocks AND each toggle's
children, then check comments per block. Use this exact scan (a subtly broken
loop here silently hides feedback — this pattern is verified):

    for B in $(curl -s "https://api.notion.com/v1/blocks/<page_id>/children?page_size=100" "${H[@]}" | jq -r '.results[].id'); do
      for K in $B $(curl -s "https://api.notion.com/v1/blocks/$B/children?page_size=100" "${H[@]}" | jq -r '.results[]?.id // empty'); do
        curl -s "https://api.notion.com/v1/comments?block_id=$K" "${H[@]}" \
          | jq -r --arg b "$K" '.results[] | $b + " | " + .discussion_id + " | " + (.rich_text | map(.plain_text) | join(""))'
      done
    done

Reply in the SAME thread by posting with that `discussion_id`
(`POST /v1/comments` with `{"discussion_id": ..., "rich_text": [...]}`).
Revise exactly what the comment targets — a block-anchored comment means
rewrite that section (PATCH the block); a page-level comment applies to the
whole draft. If a Gmail draft was promoted, update it too (update_draft) so
both copies match. Reply in the same thread: "🤖 Revised — <one line on what
changed>." Item stays `drafted`. Iterate as many rounds as Paul wants.

### 5c. Promotion pass

For `drafted` pages whose toggle says "not yet promoted": create the
Gmail/Slack draft object now if the connector is available, update the toggle.

## 6. File

- Set `Priority` (1–10) only if empty: 8–10 due within 3 days or urgent
  wording; 5–7 due this month or clearly important; 1–4 someday/nice-to-have.
- Set `Agent`: `drafted` if step 5 produced anything, else `processed`.
- Apply Status mirroring (see above).
- Ambiguous item (can't categorize, or intent unclear): post a comment with
  1–2 short questions ("🤖 …?"), set `Agent` = `needs input`. Ask directly
  in chat too if Paul is in the session.
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
- Only flip `Agent` after all of the item's processing succeeded — a crashed
  run must leave the item `new` so the next run retries it.

## 7. Report

End with a short summary: items processed, drafts created/revised (with
links), anything waiting on Paul. Nothing else — no process narration.
