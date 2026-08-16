# "Add To-Do" Shortcut — thin launcher (v2)

The Shortcut no longer parses or writes anything. It dictates, calls the Val Town
endpoint twice (parse → save), lets you edit the title in between, and shows the
result. Turn OFF Smart Punctuation before typing any JSON/URLs.

Replace `VALURL` with your Val Town URL (e.g. `https://paul-todocapture.val.run`)
and `SECRET` with your `TODO_SHARED_SECRET`.

## Actions (in order)

1. **Dictate Text** → output `DictatedText`

2. **Text** action holding your secret → rename **Secret** (keeps it out of the
   header field's history and easy to rotate)

3. **Dictionary** action (build the parse body):
   - key `text` = [DictatedText]
   → this is `ParseBody`

4. **Get Contents of URL**
   - URL: `VALURL/parse`
   - Method: **POST**
   - Headers: `x-todo-secret` = [Secret] · `content-type` = `application/json`
   - Request Body: **JSON** → [ParseBody]  (or File → a Text action of the JSON)
   → output `ParseResponse`

5. **Get Dictionary from Input** on [ParseResponse]

6. Four **Get Dictionary Value** + **Set Variable** pairs (from that dictionary):
   - `title`   → Set Variable `vTitle`
   - `project` → Set Variable `vProject`
   - `due`     → Set Variable `vDue`
   - `summary` → Set Variable `vSummary`

7. **Ask for Input** (Text)
   - Prompt: `Filed under [vProject]:`
   - Default Answer: [vTitle]
   → output `FinalTitle`   (this is your editable title check)

8. **Dictionary** action (build the save body):
   - `title`   = [FinalTitle]
   - `project` = [vProject]
   - `due`     = [vDue]
   - `summary` = [vSummary]
   → this is `SaveBody`

9. **Get Contents of URL**
   - URL: `VALURL/save`
   - Method: **POST**
   - Headers: `x-todo-secret` = [Secret] · `content-type` = `application/json`
   - Request Body: **JSON** → [SaveBody]
   → output `SaveResponse`

10. **Get Dictionary Value** `message` from [SaveResponse] → Set Variable `Msg`

11. **Show Notification** → [Msg]

## Why this can't silently fail like before

- No JSON is hand-assembled and no due-date logic lives here — the endpoint owns
  both, so the empty-`due` bug and mis-picked-pill bugs are gone.
- The endpoint returns a human `message` on every failure (parse or save), and
  the Shortcut shows it. If `/parse` fails, you never reach `/save` — nothing is
  written, board stays clean.
- Using the **Dictionary** action (not a typed-out Text template) means Shortcuts
  escapes the JSON for you — no curly-quote corruption.

## Test after building

Dictate a **dateless** work task (e.g. "email Ryan about the Emmy edits").
It should land in Notion with no due date — the exact case that used to fail.
