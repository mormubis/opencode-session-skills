---
name: session-push
description: Use when sending a message, context, or instructions to another OpenCode conversation — queueing context for its next turn or triggering AI work in a different session.
---

# Push Message to Another OpenCode Session

## When to Use

- Sending results or context to another conversation
- Triggering work in a session running in a different terminal
- Leaving context for a session's next turn

## Quick Reference

| Mode | Tool call | Behavior |
|------|-----------|----------|
| Queue context | `session_push(sessionId, message, noReply=true)` | No turn starts. The message joins the conversation on the session's next turn |
| Trigger work | `session_push(sessionId, message)` | An idle session starts a turn now, a busy one handles the message after its current turn |

## Find the Target Session

Use `project_search` to find sessions by keyword. It returns session IDs and titles. Copy the session ID and pass it to `session_push`.

```
project_search(query="browser sdk refactor")
→ returns list with sessionId, title, projectName

session_push(sessionId="abc123...", message="Context from another session...")
```

## How delivery works

`session_push` sends the message through the shared OpenCode service, the same one every TUI is connected to. A TUI showing the target session updates live.

- **Without `noReply`:** an idle session starts a turn in the background right away. A busy session handles the message after its current turn ends.
- **With `noReply=true`:** no turn starts. The message stays pending and is not in the session's history yet. It joins the conversation as a user message when the session's next turn runs, whoever starts it.

An unknown session ID fails with a tool error.

## Common Mistakes

**Pushing to the wrong session** — use `project_search` first and verify the title before pushing.

**Expecting `noReply=true` to show up right away** — it doesn't. A session nobody prompts again never shows it.

**Session is actively running** — the push waits until the current turn ends.
