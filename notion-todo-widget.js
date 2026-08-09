// Variables used by Scriptable.
// icon-color: deep-blue; icon-glyph: check-square;

// Token is read from the iOS Keychain, not hardcoded. One-time setup: in a
// separate Scriptable script, run  Keychain.set("NOTION_TOKEN", "ntn_...")  once,
// then delete that script. The widget reads it here at runtime.
const NOTION_TOKEN = Keychain.contains("NOTION_TOKEN") ? Keychain.get("NOTION_TOKEN") : "";
const DATABASE_ID = "88bb6658-8965-4a87-a7f0-c86067a7ffc2";
const ASSIGNEE_USER_ID = "55e82040-9178-4fe9-844b-1cf2aeda8db1"; // Paul Gehrig

// Controls section order; anything not listed here falls into "No project" at the end.
const PROJECT_ORDER = ["🧭 Nava", "🤖 CourtChat", "🏠 Home", "🐺 UW", "🧠 Civic Insights", "💡 Projects"];

async function getTasks() {
  const req = new Request(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`);
  req.method = "POST";
  req.headers = {
    "Authorization": `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
  req.body = JSON.stringify({
    filter: {
      and: [
        { property: "Assignee", people: { contains: ASSIGNEE_USER_ID } },
        { or: [
            { property: "Status", status: { equals: "to do" } },
            { property: "Status", status: { equals: "in progress" } },
            { property: "Status", status: { equals: "waiting" } }
          ]
        }
      ]
    },
    sorts: [{ property: "Due", direction: "ascending" }]
  });

  const res = await req.loadJSON();
  if (!res.results) return [];

  return res.results.map(page => {
    const props = page.properties;
    const title = props["Task name"]?.title?.[0]?.plain_text ?? "Untitled";
    const due = props["Due"]?.date?.start ?? null;
    const project = props["Project"]?.select?.name ?? null;
    return { title, due, url: page.url, project };
  });
}

function formatDue(dueString) {
  if (!dueString) return "No due date";
  const date = new Date(dueString);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function createWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));

  const title = widget.addText("To Do");
  title.font = Font.boldSystemFont(16);
  title.textColor = Color.dynamic(new Color("#000000"), new Color("#ffffff"));
  widget.addSpacer(8);

  let tasks = [];
  let loadFailed = false;
  try {
    tasks = await getTasks();
  } catch (e) {
    loadFailed = true;
  }

  if (loadFailed) {
    const errText = widget.addText("Couldn't load tasks");
    errText.font = Font.systemFont(12);
    errText.textColor = Color.red();
  } else if (tasks.length === 0) {
    const empty = widget.addText("Nothing on your list \u{1F389}");
    empty.font = Font.systemFont(13);
    empty.textColor = Color.gray();
  } else {
    const groups = {};
    tasks.forEach(task => {
      const key = task.project ?? "\u{1F4CC} No project";
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    });

    const orderedKeys = [
      ...PROJECT_ORDER.filter(p => groups[p]),
      ...Object.keys(groups).filter(p => !PROJECT_ORDER.includes(p))
    ];

    const maxItems = 10;
    let shown = 0;

    for (const key of orderedKeys) {
      if (shown >= maxItems) break;

      const header = widget.addText(key);
      header.font = Font.semiboldSystemFont(11);
      header.textColor = Color.gray();
      widget.addSpacer(2);

      for (const task of groups[key]) {
        if (shown >= maxItems) break;

        const row = widget.addStack();
        row.layoutHorizontally();
        row.url = task.url;
        row.setPadding(6, 4, 6, 4);
        row.cornerRadius = 6;
        row.backgroundColor = Color.dynamic(new Color("#f2f2f7"), new Color("#2c2c2e"));

        const emoji = row.addText(key.split(" ")[0]);
        emoji.font = Font.systemFont(13);
        row.addSpacer(4);

        const name = row.addText(task.title);
        name.font = Font.systemFont(13);
        name.textColor = Color.dynamic(new Color("#000000"), new Color("#ffffff"));
        name.lineLimit = 1;

        row.addSpacer();

        const due = row.addText(formatDue(task.due));
        due.font = Font.systemFont(12);
        due.textColor = Color.gray();

        shown++;
        widget.addSpacer(4);
      }

      widget.addSpacer(6);
    }
  }

  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  return widget;
}

const widget = await createWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}
Script.complete();
