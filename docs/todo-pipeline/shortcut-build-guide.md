# "Add To-Do" Siri Shortcut — Build Guide

Build this in the **Shortcuts app on your Mac** (easiest — you can copy-paste
the JSON blocks below straight from this file) — it syncs to your iPhone via
iCloud automatically. Total build time: ~20 minutes.

**What it does:** dictate → Claude cleans + categorizes (~1s) → you confirm or
edit the title → item lands in ✅ To do, filed and tagged `Agent: new`. If the
Claude call ever fails, the raw dictation is saved to Notion anyway.

---

## Before you start

Have these two values ready (from `~/.config/todo-intake/env`):
- `NOTION_TOKEN` (starts `ntn_`)
- `ANTHROPIC_API_KEY` (starts `sk-ant-`)

Terminal command to display them: `cat ~/.config/todo-intake/env`

---

## Build steps

Create a new shortcut named **Add To-Do**. Add actions in this exact order.
Names in [brackets] are variables — insert them via "Select Variable" or by
typing the magic-variable name.

### Part 1 — capture & sanitize

1. **Dictate Text** (category: Documents). Language: English. Stop Listening:
   After Pause. Output: `Dictated Text`.
2. **Replace Text**: find `"` replace with `'`, in `Dictated Text`.
   (Prevents a spoken quote from breaking the JSON below.)
   Rename output variable: **CleanDictation**.
3. **Format Date** on **Current Date**: Date Format = Custom, format string
   `yyyy-MM-dd`. Output: **Today**.
4. **Text** action containing your Anthropic key. Rename: **AnthropicKey**.
5. **Text** action containing your Notion token. Rename: **NotionToken**.

### Part 2 — Claude call

6. **Text** action — paste this entire block, then replace `INSERT_TODAY`
   with the [Today] variable and `INSERT_DICTATION` with [CleanDictation].
   Rename: **ClaudeBody**.

```
{"model":"claude-haiku-4-5","max_tokens":500,"system":"You convert a voice-dictated to-do into a clean task entry. Today's date is INSERT_TODAY.\n\nRules:\n- title: rewrite the dictation as a short imperative task title (max ~70 chars). Fix speech-to-text artifacts. Keep names and specifics.\n- project: pick exactly one:\n  - \"🧭 Nava\" — Paul's job at Nava PBC: client work, Emmy design system, work meetings, coworkers, HR/benefits.\n  - \"🤖 CourtChat\" — the CourtChat side project: court reminders product, its knowledgebase, pilots, admin panel.\n  - \"🏠 Home\" — household/personal errands: family, house upkeep, appointments, shopping, kids, health.\n  - \"🐺 UW\" — University of Washington related items.\n  - \"🧠 Civic Insights\" — the Civic Insights project.\n  - \"💡 Projects\" — other side projects, ideas, tinkering that fits nowhere above.\n  - \"🏘️ Compound\" — the Compound property: tenants, renovations, financing, utilities, property logistics.\n- due: if the dictation states or implies a deadline (\"by Friday\", \"before the 15th\", \"tomorrow\"), resolve it to a YYYY-MM-DD date using today's date. Otherwise \"\".\n- summary: one sentence holding any detail that did not fit in the title (context, names, amounts). \"\" if the title captures everything.","messages":[{"role":"user","content":"INSERT_DICTATION"}],"output_config":{"format":{"type":"json_schema","schema":{"type":"object","properties":{"title":{"type":"string"},"project":{"type":"string","enum":["🧭 Nava","🤖 CourtChat","🏠 Home","🐺 UW","🧠 Civic Insights","💡 Projects","🏘️ Compound"]},"due":{"type":"string"},"summary":{"type":"string"}},"required":["title","project","due","summary"],"additionalProperties":false}}}}
```

7. **Get Contents of URL**:
   - URL: `https://api.anthropic.com/v1/messages`
   - Method: POST
   - Headers: `x-api-key` = [AnthropicKey] · `anthropic-version` = `2023-06-01`
     · `content-type` = `application/json`
   - Request Body: **File** → [ClaudeBody]
   Output: **ClaudeResponse**.

### Part 3 — parse & confirm

**Naming rule (learned the hard way):** after every action whose output is
used anywhere other than the directly-following action, add a **Set Variable**
with an explicit name. Shortcuts' unnamed "magic variable" pills (Dictionary
Value, Text, Updated Text…) are indistinguishable in the variable picker once
you have several, and a mis-picked pill fails silently.

8. **Get Dictionary from Input** on [ClaudeResponse].
9. **Get Dictionary Value**: key `content.1.text` (a dot-path: key `content`,
   item 1, key `text` — one action instead of three), Dictionary: leave the
   grayed auto-input. → **Set Variable** `ResultJSON`.
10. **Get Dictionary from Input** on [ResultJSON]. → **Set Variable** `Result`.
11. Four Get/Set pairs, each Get pulling from [Result] by name:
    - **Get Dictionary Value** key `title` → **Set Variable** `vTitle`
    - **Get Dictionary Value** key `project` → **Set Variable** `vProject`
    - **Get Dictionary Value** key `due` → **Set Variable** `vDue`
    - **Get Dictionary Value** key `summary` → **Set Variable** `vSummary`
12. **If** [vTitle] *has any value*:   ← everything until "Otherwise" goes inside

    a. **Ask for Input** (Input Type: Text):
       - Prompt: `Filed under [vProject]:` (insert the vProject variable)
       - Default Answer: [vTitle]
       This is the editable confirm — Siri speaks the prompt; edit by keyboard
       or tap Done. Output: **FinalTitle**.
    b. **Replace Text**: find `"` replace `'` in [FinalTitle] → **Set Variable** `SafeTitle`.
    c. **Replace Text**: find `"` replace `'` in [vSummary] → **Set Variable** `SafeSummary`.
    d. **If** [vDue] *has any value* (nested if):
       - **Text**: `{"start":"INSERT_DUE"}` with [vDue] inserted → **Set Variable** `DueJSON`
       - **Otherwise** → **Text**: `null` → **Set Variable** `DueJSON`
       - **End If** (same variable name in both branches)
    e. **Text** action — paste, then insert the named variables where marked:
       `INSERT_SAFETITLE` → [SafeTitle], `INSERT_PROJECT` → [vProject],
       `INSERT_SAFESUMMARY` → [SafeSummary], `INSERT_DUEJSON` → [DueJSON]
       (DueJSON deliberately has no quotes around it in the template).
       Rename: **NotionBody**.

```
{"parent":{"type":"data_source_id","data_source_id":"738b360f-dcb0-4388-80d6-df62ba0a9e00"},"properties":{"Task name":{"title":[{"text":{"content":"INSERT_SAFETITLE"}}]},"Project":{"select":{"name":"INSERT_PROJECT"}},"Status":{"status":{"name":"to do"}},"Agent":{"select":{"name":"new"}},"Assignee":{"people":[{"id":"55e82040-9178-4fe9-844b-1cf2aeda8db1"}]},"Summary":{"rich_text":[{"text":{"content":"INSERT_SAFESUMMARY"}}]},"Due":{"date":INSERT_DUEJSON}}}
```

    f. **Get Contents of URL**:
       - URL: `https://api.notion.com/v1/pages`
       - Method: POST
       - Headers: `Authorization` = `Bearer [NotionToken]` (type the word
         Bearer, a space, then insert the variable) · `Notion-Version` =
         `2025-09-03` · `content-type` = `application/json`
       - Request Body: **File** → [NotionBody]
    g. **Show Notification**: `Added: [FinalTitle] → [Project]`

13. **Otherwise** (Claude call failed — fallback):

    a. **Text** action → **FallbackBody**:

```
{"parent":{"type":"data_source_id","data_source_id":"738b360f-dcb0-4388-80d6-df62ba0a9e00"},"properties":{"Task name":{"title":[{"text":{"content":"INSERT_CLEANDICTATION"}}]},"Status":{"status":{"name":"to do"}},"Agent":{"select":{"name":"new"}},"Assignee":{"people":[{"id":"55e82040-9178-4fe9-844b-1cf2aeda8db1"}]}}}
```

    (insert [CleanDictation] where marked)
    b. **Get Contents of URL** — identical to step 12f but body [FallbackBody].
    c. **Show Notification**: `Saved raw (cleanup queued): [CleanDictation]`

14. **End If**.

### Part 4 — Siri & polish

15. Shortcut settings (ⓘ on iPhone / name-click on Mac): confirm the name is
    **Add To-Do** — "Hey Siri, Add To-Do" then works automatically. Optionally
    add it to the Home Screen and the Action Button.

---

## Warnings

- **Never reorder the If/Otherwise branches** when editing later — the
  Otherwise branch is the never-lose-a-capture fallback.
- The two secret Text actions live only in this Shortcut (iCloud-synced).
  If you ever share the Shortcut, delete the secrets first.
- If a JSON body errors: the usual cause is a straight quote (`"`) typed into
  the Text action being auto-converted to curly quotes (`""`). Turn off
  Settings → General → Keyboard → Smart Punctuation on iPhone, or paste from
  this file rather than typing.

## Incremental testing (build a part, test it, continue)

Two tricks: (1) while building, replace **Dictate Text** with a plain **Text**
action holding `pick up the dry cleaning tomorrow` — no re-dictating on every
run; swap Dictate back at the end. (2) add a **Show Result** action after each
stage to inspect output, delete them when done.

| Checkpoint | After | Show Result on | Expect |
|---|---|---|---|
| A | Part 1 (steps 1–5) | CleanDictation, Today | your phrase; today's date |
| B | step 7 | ClaudeResponse | JSON containing `"content":[{"type":"text"...` (an `"error"` key = bad key/header) |
| C | step 11 | Title, Project, Due | clean title; 🏠 Home; tomorrow's date |
| D | step 12a | — | editable confirm with title pre-filled |
| E | step 12f | URL response | JSON with `"object":"page"` and an `"id"` (a `"message"` = body validation error) |
| F | fallback branch | — | "Saved raw" notification with broken key |

## Test checklist (after building)

1. Run "Hey Siri, add to-do" → dictate *"pick up the dry cleaning tomorrow"*
   → expect confirm prompt "Filed under 🏠 Home", then a Notion item with
   tomorrow's due date and Agent = new.
2. Break the Anthropic key (add an `x` in the AnthropicKey Text action), run
   again with any phrase → expect "Saved raw" notification and a raw item in
   Notion. Fix the key afterward.
