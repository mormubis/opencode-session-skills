---
name: jump-to-conversation
description: Use when switching to a different OpenCode conversation, opening a past session in a new terminal, or resuming/forking a session from another project.
---

# Jump to Another OpenCode Conversation

Open another OpenCode session in a new terminal window. Supports resuming where it left off or forking into a new branch of the conversation.

## When to Use

- Switching to a conversation in a different project
- Resuming a past session in a new terminal
- Forking a session to try a different approach without losing the original

## Find the Session

### By keyword search

```
project_search({ query: "authentication refactor" })
```

Returns matching sessions with excerpts across all projects.

### By browsing

```
project_list()
```

Lists all known projects and their recent sessions.

### Via interactive picker

```
project_sessions()
```

Opens the native session picker UI.

## Jump to It

```
project_jump({
  projectPath: "/path/to/project",
  sessionId: "ses_abc123",
  mode: "resume"
})
```

### Modes

| Mode | Behavior |
|------|----------|
| `resume` | Continues the session where it left off. New messages append to the existing conversation. |
| `fork` | Creates a copy of the session. The original stays untouched, the fork gets new messages. |

### Without a session ID

If you omit `sessionId`, OpenCode opens the project and starts fresh or lets the user pick a session.

```
project_jump({
  projectPath: "/path/to/project"
})
```

## Common Mistakes

**Resume vs fork** — if the session might be active in another terminal, fork it. Resuming an active session in two places can cause conflicts.

**Wrong project path** — the `projectPath` must point to an actual project directory. Use `project_list()` to discover valid paths.
