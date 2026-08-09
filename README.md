# Todo Agent Workflow

A voice-driven to-do pipeline: dictate a task → Claude cleans and categorizes it →
it lands in Notion, where an agent enriches, drafts, and iterates on it. Plus an
iOS home-screen widget for a live sneak peek of the list.

## How it works

1. **Capture** — a Siri Shortcut ("Add To-Do") takes dictation and calls the Claude
   API (Haiku, structured outputs) to rewrite it into a clean title, pick a project,
   resolve a due date, and write a one-line summary. The result is confirmed via an
   editable prompt, then written to the Notion "To do" database with `Agent = new`.
2. **Process** — the `todo-intake` skill (and an hourly cloud routine) sweeps
   `Agent = new` items: de-dupes, enriches with context, and — by task shape — drafts
   first passes (email / doc / Slack / research). Conversation happens in Notion
   comment threads; drafts iterate via a comment-driven revision loop.
3. **View** — a Scriptable iOS widget shows a sneak peek of open tasks, sorted by
   due date.

## Contents

| Path | What it is |
|---|---|
| `.claude/skills/todo-intake/SKILL.md` | The `/todo-intake` sweep skill |
| `docs/todo-pipeline/capture-system-prompt.txt` | Claude capture prompt (voice → structured task) |
| `docs/todo-pipeline/capture-request-template.json` | Claude API request contract for capture |
| `docs/todo-pipeline/shortcut-build-guide.md` | Step-by-step Siri Shortcut build guide |
| `docs/todo-pipeline/probe-results.md` | Cloud-routine capability probe results |
| `docs/superpowers/specs/2026-08-09-voice-todo-pipeline-design.md` | Design spec |
| `docs/superpowers/plans/2026-08-09-voice-todo-pipeline.md` | Implementation plan |
| `notion-todo-widget.js` | Scriptable iOS widget |
| `todo-pipeline-setup-steps.txt` | Secrets + integration setup notes |

## Notion To-Do Widget

A medium-size widget that shows a sneak peek of your Notion to-do list: open tasks
(`to do` / `in progress`), sorted by due date with the soonest at the top. Tasks
without a due date sink to the bottom. Each row shows the task's project emoji,
title, and due date; tapping a row opens the task in Notion.

### Setup

1. Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) on your iPhone.
2. Create a new script and paste in [`notion-todo-widget.js`](notion-todo-widget.js).
3. Store your Notion token in the iOS Keychain — the widget reads it from there, it is
   **not** hardcoded. In a separate Scriptable script, run once:
   ```js
   Keychain.set("NOTION_TOKEN", "ntn_your_integration_token")
   ```
   then delete that script. Create the integration at
   [notion.so/my-integrations](https://www.notion.so/my-integrations) and share your
   to-do database with it.
4. Set the other two constants at the top of the widget:
   - `DATABASE_ID` — the 32-character ID in your database's URL.
   - `ASSIGNEE_USER_ID` — your Notion user ID (call `GET https://api.notion.com/v1/users` with your token).
5. The script assumes your database has these properties (rename in the code if yours differ):
   - **Task name** (title)
   - **Status** (status: `to do`, `in progress`, …)
   - **Due** (date)
   - **Project** (select — option names start with an emoji, e.g. `🏠 Home`)
   - **Assignee** (people)
6. Add a **medium** Scriptable widget to your home screen and point it at the script.

The widget refreshes itself roughly every 15 minutes.
