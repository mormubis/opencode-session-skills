---
name: session-push
description: Use when sending a message, context, or instructions to another OpenCode conversation — silent context injection or triggering AI work in a different session.
---

# Push Message to Another OpenCode Session

## When to Use

- Sending results or context to another conversation
- Triggering work in a session running in a different terminal
- Injecting context for a future session resumption

## Quick Reference

| Mode | Tool call | Behavior |
|------|-----------|----------|
| Context injection | `session_push(sessionId, message, noReply=true)` | Silent, no AI response |
| Trigger work | `session_push(sessionId, message)` | AI responds in the target session |

## Find the Target Session

Use `project_search` to find sessions by keyword. It returns session IDs and titles. Copy the session ID and pass it to `session_push`.

```
project_search(query="browser sdk refactor")
→ returns list with sessionId, title, projectName

session_push(sessionId="abc123...", message="Context from another session...")
```

## How real-time delivery works

Each plugin instance watches a file-based push queue for its sessions (`~/.local/share/opencode/push-queue/{sessionId}/`). When `session_push` writes a message file, the target session's own plugin picks it up via `fs.watch` and calls `client.session.promptAsync()` through the correct server — the same one the TUI is subscribed to. That server fires the SSE event and the TUI updates live.

If the target session is inactive (not open in any terminal), the message file stays in the queue and is delivered the next time that session is opened.

## Common Mistakes

**Pushing to the wrong session** — use `project_search` first and verify the title before pushing.

**Session is actively running** — messages are queued. If the target session is in the middle of a task, the push will be processed after the current task completes.
