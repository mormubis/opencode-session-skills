---
name: session-jump
description: Use when switching to a different OpenCode conversation, opening a past session in a new terminal or Herdr workspace, or resuming or forking a session from another project.
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

## Jumping to a Brand-New Directory (e.g. a Worktree)

`projectPath` doesn't need to be a project OpenCode has opened before. If another conversation just created a worktree, jump straight to it — no `project_list()` or `project_search()` needed:

```
project_jump({
  projectPath: "/path/to/new-worktree"
})
```

Omit `sessionId` since there's no existing session yet. OpenCode registers the directory as a new project on launch.

## Closing the Current Session

Pass `closeCurrent: true` to exit the current session right after the new terminal opens successfully:

```
project_jump({
  projectPath: "/path/to/project",
  sessionId: "ses_abc123",
  mode: "resume",
  closeCurrent: true
})
```

Only exits on success — if the terminal fails to open, the current session stays open.

## Bash Fallback

If `project_jump()` is unavailable, use the TUI directly:

```bash
# Resume
opencode -s <session_id> <project_path>

# Fork
opencode -s <session_id> --fork <project_path>
```

**Never use `opencode run --session`** — `run` requires a message and will fail with "You must provide a message or a command".

The destination is detected automatically from the environment, checked in this order: `HERDR_ENV=1` → new Herdr workspace (via `herdr workspace create` + `herdr pane run`, focused, labeled with the project name), `TMUX` → tmux window, macOS → terminal app detected via env vars (`ITERM_SESSION_ID` → iTerm, `GHOSTTY_RESOURCES_DIR` → Ghostty). `project_jump()` handles this; the bash command above opens in the current terminal.

## Common Mistakes

**Wrong CLI subcommand** — `opencode run --session <id>` fails. Use `opencode -s <id> <path>`.

**Resume vs fork** — if the session might be active in another terminal, fork it. Resuming in two places causes conflicts.

**Wrong project path** — `projectPath` just needs to be a real directory on disk; it does not need to be a project OpenCode already knows about. `project_list()` only shows previously-opened projects, so a brand-new directory (e.g. a worktree you just created) won't appear there — that's expected. Skip `project_list()` for those and pass the path directly; OpenCode registers it as a new project on launch.
