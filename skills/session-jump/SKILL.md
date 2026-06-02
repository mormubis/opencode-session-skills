---
name: session-jump
description: Use when switching to a different OpenCode conversation, opening a past session in a new terminal, or resuming or forking a session from another project.
---

# Jump to Another OpenCode Conversation

Find a session, then open it with `project_jump()` in resume or fork mode.

## Quick Reference

| Goal | Tool |
|------|------|
| Search by keyword | `project_search({ query: "keyword" })` |
| Browse all projects | `project_list()` |
| Interactive UI picker | `project_sessions()` |
| Open session | `project_jump({ projectPath, sessionId, mode })` |

## Jump to It

```
project_jump({
  projectPath: "/path/to/project",
  sessionId: "ses_abc123",
  mode: "resume"
})
```

| Mode | Behavior |
|------|----------|
| `resume` | Appends to existing conversation. |
| `fork` | Copies the session. Original stays untouched. |

Omit `sessionId` to open the project fresh or let the user pick.

## Bash Fallback

If `project_jump()` is unavailable, use the TUI directly:

```bash
# Resume
opencode -s <session_id> <project_path>

# Fork
opencode -s <session_id> --fork <project_path>
```

**Never use `opencode run --session`** — `run` requires a message and will fail with "You must provide a message or a command".

On macOS, the terminal is detected automatically via env vars (`ITERM_SESSION_ID` → iTerm, `GHOSTTY_RESOURCES_DIR` → Ghostty, `TMUX` → tmux window). `project_jump()` handles this; the bash command above opens in the current terminal.

## Common Mistakes

**Wrong CLI subcommand** — `opencode run --session <id>` fails. Use `opencode -s <id> <path>`.

**Resume vs fork** — if the session might be active in another terminal, fork it. Resuming in two places causes conflicts.

**Wrong project path** — must point to an actual project directory. Use `project_list()` to discover valid paths.
