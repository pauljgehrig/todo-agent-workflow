// To-Do Capture — Val Town HTTP service
// ---------------------------------------------------------------------------
// Replaces the brittle logic that used to live inside the Apple Shortcut.
// Two routes:
//   POST /parse  {text}                          -> {title, project, due, summary}
//   POST /save   {title, project, due, summary}  -> {ok, message}
//
// The Shortcut is now a thin launcher: dictate -> POST /parse -> edit title ->
// POST /save -> show message. All parsing, validation, and the Notion write
// happen here, where there are real logs and real errors.
//
// Secrets (Val Town env vars):
//   ANTHROPIC_API_KEY   - Anthropic API key
//   NOTION_TOKEN        - Notion internal integration token (ntn_...)
//   TODO_SHARED_SECRET  - shared secret; the Shortcut sends it as x-todo-secret
//
// Deploy: paste into a new Val Town HTTP val, set the three env vars.
// ---------------------------------------------------------------------------

const NOTION_DATA_SOURCE_ID = "738b360f-dcb0-4388-80d6-df62ba0a9e00";
const NOTION_VERSION = "2025-09-03";
const ASSIGNEE_ID = "55e82040-9178-4fe9-844b-1cf2aeda8db1"; // Paul Gehrig
const MODEL = "claude-haiku-4-5";

const PROJECTS = [
  "🧭 Nava",
  "🤖 CourtChat",
  "🏠 Home",
  "🐺 UW",
  "🧠 Civic Insights",
  "💡 Projects",
  "🏘️ Compound",
] as const;
const DEFAULT_PROJECT = "💡 Projects"; // fallback if the model returns an out-of-enum value

function systemPrompt(today: string): string {
  return `You convert a voice-dictated to-do into a clean task entry. Today's date is ${today}.

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
- summary: one sentence holding any detail that did not fit in the title (context, names, amounts). "" if the title captures everything.`;
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    project: { type: "string", enum: PROJECTS },
    due: { type: "string" },
    summary: { type: "string" },
  },
  required: ["title", "project", "due", "summary"],
  additionalProperties: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authOK(req: Request): boolean {
  const want = Deno.env.get("TODO_SHARED_SECRET") ?? "";
  return want.length > 0 && req.headers.get("x-todo-secret") === want;
}

function todayISO(): string {
  // en-CA gives YYYY-MM-DD; pin to Pacific so "tomorrow" matches Paul's day.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// --- /parse ----------------------------------------------------------------
async function handleParse(req: Request): Promise<Response> {
  const { text } = await req.json().catch(() => ({ text: "" }));
  if (!text || typeof text !== "string" || !text.trim()) {
    return json({ ok: false, message: "parse: empty dictation text" }, 400);
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt(todayISO()),
      messages: [{ role: "user", content: text }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    return json({ ok: false, message: `parse: Anthropic ${resp.status}: ${data?.error?.message ?? "error"}` }, 502);
  }
  const raw = data?.content?.[0]?.text;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ ok: false, message: `parse: model returned non-JSON: ${String(raw).slice(0, 120)}` }, 502);
  }
  return json({
    title: String(parsed.title ?? "").trim(),
    project: String(parsed.project ?? "").trim(),
    due: String(parsed.due ?? "").trim(),
    summary: String(parsed.summary ?? "").trim(),
  });
}

// --- /save -----------------------------------------------------------------
async function handleSave(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  let project = String(body.project ?? "").trim();
  const due = String(body.due ?? "").trim();
  const summary = String(body.summary ?? "").trim();

  if (!title) return json({ ok: false, message: "save: empty title, nothing written" }, 400);
  if (!PROJECTS.includes(project as any)) project = DEFAULT_PROJECT; // never lose a capture

  // THE FIX: empty due -> null (Notion rejects {"start":""} with a 400)
  const dueProp = due ? { date: { start: due } } : { date: null };

  const properties: Record<string, unknown> = {
    "Task name": { title: [{ text: { content: title } }] },
    "Project": { select: { name: project } },
    "Status": { status: { name: "to do" } },
    "Agent": { select: { name: "new" } },
    "Assignee": { people: [{ id: ASSIGNEE_ID }] },
    "Summary": { rich_text: [{ text: { content: summary } }] },
    "Due": dueProp,
  };

  const resp = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("NOTION_TOKEN") ?? ""}`,
      "Notion-Version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: NOTION_DATA_SOURCE_ID },
      properties,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    return json({ ok: false, message: `save: Notion ${resp.status}: ${data?.message ?? "error"}` }, 502);
  }
  return json({ ok: true, message: `Added: ${title} → ${project}`, id: data?.id ?? null, url: data?.url ?? null });
}

// --- router ----------------------------------------------------------------
export default async function (req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);
  if (!authOK(req)) return json({ ok: false, message: "unauthorized" }, 401);

  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/parse")) return await handleParse(req);
    if (path.endsWith("/save")) return await handleSave(req);
    return json({ ok: false, message: `unknown route ${path} (use /parse or /save)` }, 404);
  } catch (err) {
    return json({ ok: false, message: `server error: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
}
