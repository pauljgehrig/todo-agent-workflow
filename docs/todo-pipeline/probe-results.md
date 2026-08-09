# Scheduled-run capability probe — results

**Probe run:** 2026-08-09, one-shot cloud routine (`trig_01RnQpn3athQWD5JGaL9LyA2`),
Emmy environment, Notion/Gmail/Slack connectors attached. Report delivered by the
probe itself as a block append to a Notion test page (which doubled as the write test).

| Check | Result | Implication |
|---|---|---|
| `~/.config/todo-intake/env` readable | **no** | Cloud routines run in a sandbox with no local files — the Notion token path is unavailable there |
| Notion connector (read + write) | **ok** | Routine can query the To do database and write blocks/properties via the connector |
| Gmail connector tools present | **yes** | Routine can promote email drafts to real Gmail drafts |
| Slack connector tools present | **yes** | Routine can create Slack message drafts |

## Decision (Task 7 shape)

Full-capability sweep in the cloud, connector-based:
- The hourly routine embeds the sweep logic in its prompt (self-contained — the
  cloud agent has no access to `~/.claude/skills/todo-intake/SKILL.md`) and uses
  the **Notion/Gmail/Slack connectors** instead of the integration token.
- The local `/todo-intake` skill keeps the **token/curl** path (works offline from
  connectors, and is the debugging surface).
- No secrets are stored in the routine: connectors carry their own auth. The
  spec's "token by construction" rule applies to the local path; connectors are
  the platform-sanctioned equivalent for cloud routines.
