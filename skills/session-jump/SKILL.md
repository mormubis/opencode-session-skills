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

## Common Mistakes

**Resume vs fork** — if the session might be active in another terminal, fork it. Resuming in two places causes conflicts.

**Wrong project path** — must point to an actual project directory. Use `project_list()` to discover valid paths.
