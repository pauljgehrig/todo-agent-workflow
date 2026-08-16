# "Add To-Do" Shortcut — thin launcher (v2, as-built)

The Shortcut no longer parses or writes anything. It dictates, calls the Val Town
endpoint twice (parse → save), lets you edit the title in between, and shows the
result. All parsing, the prompt, the schema, today's date, and the Notion write
live in the endpoint (`todo-capture.ts`), where there are real logs and errors.

**Deployed endpoint:** `https://pjg-todo-capture.val.run`
(Val `pauljgehrig/todo-capture`, routes `/parse` and `/save`.)

Replace `SECRET` below with your `TODO_SHARED_SECRET` (set as a Val Town env var).
The endpoint holds `ANTHROPIC_API_KEY` and `NOTION_TOKEN` — **neither belongs in
the Shortcut anymore.**

## Actions (in order)

1. **Dictate Text** → magic var `Dictated Text`

2. **Text** action holding your secret → **Set Variable** `Secret`
   (keeps it out of the header field and easy to rotate)

3. **Get Contents of URL**
   - URL: `https://pjg-todo-capture.val.run/parse`
   - Method: **POST**
   - Headers: `x-todo-secret` = [Secret] · `content-type` = `application/json`
   - Request Body: **JSON** → add one field, type **Text**:
     `text` = [Dictated Text]
   → output `Contents of URL`

   > Use inline JSON fields here (NOT a hand-typed Text template and NOT a
   > separate Dictionary action). Shortcuts escapes the value for you, so quotes
   > in the dictation can't corrupt the body.

4. **Set Variable** `Result` = [Contents of URL]
   (the JSON response works directly as a dictionary — no "Get Dictionary from"
   step needed before extraction)

5. Four **Get Dictionary Value** + **Set Variable** pairs, each reading `in Result`:
   - `title`   → Set Variable `vTitle`
   - `project` → Set Variable `vProject`
   - `due`     → Set Variable `vDue`
   - `summary` → Set Variable `vSummary`

   > Each new Get Dictionary Value auto-fills "in" with the *nearest* variable
   > (e.g. vTitle), not Result. Re-pick **Result** on all four.

6. **Ask for Input** (Text)
   - Prompt: `Filed under [vProject]:`
   - Default Answer: [vTitle]
   → **Set Variable** `FinalTitle` = [Provided Input]   (the editable-title check)

7. **Get Contents of URL**
   - URL: `https://pjg-todo-capture.val.run/save`
   - Method: **POST**
   - Headers: `x-todo-secret` = [Secret] · `content-type` = `application/json`
   - Request Body: **JSON** → four fields, all type **Text**:
     `title` = [FinalTitle] · `project` = [vProject] · `due` = [vDue] · `summary` = [vSummary]
   → output `Contents of URL`

8. **Get Dictionary Value** `message` from that response → **Set Variable** `Msg`

9. **Show Notification** → [Msg]

## Why this can't silently fail like before

- No JSON is hand-assembled and no due-date logic lives here — the endpoint owns
  both, so the empty-`due` bug (Notion 400 on `{"start":""}`) and mis-picked-pill
  bugs are gone.
- The endpoint returns a human `message` on every failure (parse or save), and
  the Shortcut shows it. If `/parse` fails you never reach `/save` — nothing is
  written, board stays clean.
- Inline JSON body fields mean Shortcuts escapes the JSON for you — no
  curly-quote corruption.

## Build gotchas (learned deploying this 2026-08-16)

- **`create_file type:http` lands as `script`** on Val Town — set the file type
  to `http` afterward (or it 404s / "Not found").
- **Reusing old Get-Value actions after a teardown leaves broken (red) variable
  bindings** that won't reconnect. Faster to delete and re-add the four extractor
  pairs fresh than to fight them.
- **macOS Shortcuts "Show Notification" silently does not render** unless granted
  in System Settings → Notifications → Shortcuts. For debugging on Mac, drop in a
  **Quick Look** action (it always renders) pointed at the variable you're
  inspecting; delete it before finalizing. Notifications work fine on iPhone.

## Test after building

Dictate a **dateless** work task (e.g. "email Ryan about the Emmy edits").
It should land in Notion with no due date — the exact case that used to fail.
