---
name: session-push
description: Use when sending a message, context, or instructions to another OpenCode conversation — silent context injection or triggering AI work in a different session.
---

# Push Message to Another OpenCode Session

All OpenCode servers share one SQLite database. Any running server can write to any session.

## When to Use

- Sending results or context to another conversation
- Triggering work in a session running in a different terminal
- Injecting context for a future session resumption

## Quick Reference

| Mode | Endpoint | Behavior |
|------|----------|----------|
| Context injection | `POST /session/:id/message` + `noReply: true` | Silent, no AI response |
| Trigger work (async) | `POST /session/:id/prompt_async` | AI responds, non-blocking |
| Trigger work (sync) | `POST /session/:id/message` | Blocks until AI responds |

## Find the Target Session

Use `session-recover` skill to find the session ID, or query directly using `session-db` skill.

## Discover a Running Server

```bash
# Finds the first accessible server, skips 401 (auth-required)
for port in $(lsof -i -P -n 2>/dev/null | grep "opencode.*LISTEN" | awk '{print $9}' | cut -d: -f2 | sort -u); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 "http://127.0.0.1:$port/global/health" 2>/dev/null)
  if [ "$code" = "200" ]; then OC_PORT=$port; break; fi
done
```

## Push the Message

### Context injection (no AI response)

```bash
curl -s -X POST "http://127.0.0.1:$OC_PORT/session/$SESSION_ID/message" \
  -H 'Content-Type: application/json' \
  -d '{
    "noReply": true,
    "parts": [{"type": "text", "text": "Context from another session..."}]
  }'
```

### Trigger work (AI responds)

```bash
curl -s -X POST "http://127.0.0.1:$OC_PORT/session/$SESSION_ID/prompt_async" \
  -H 'Content-Type: application/json' \
  -d '{
    "parts": [{"type": "text", "text": "Please do X based on the context above."}]
  }'
```

Omit `noReply` and use `/session/:id/message` for the synchronous variant.

## Limitations

**Pushed messages don't appear in real-time.** The event bus is per-process and in-memory. The message writes to SQLite, but the TUI never receives the SSE event. Users see pushed messages when they re-enter the session. [Known limitation](https://github.com/anomalyco/opencode/issues/2403).

**Auth-protected servers.** If `OPENCODE_SERVER_PASSWORD` is set, the server requires HTTP Basic Auth (`opencode:<password>`). The discovery loop skips these.

## Common Mistakes

**Pushing to the wrong session** — verify first: `curl -s "http://127.0.0.1:$OC_PORT/session/$SESSION_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['title'])"`.

**Server not found** — no OpenCode instance running. Start one with `opencode serve`.

**Session is actively running** — messages are queued. Timing matters with `prompt_async`.
