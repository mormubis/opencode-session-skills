---
name: push-message-to-session
description: Use when sending a message, context, or instructions to another OpenCode conversation. Supports silent context injection (noReply) and triggering AI work in a different session. Combine with recover-opencode-conversation to find sessions by content or title.
---

# Push Message to Another OpenCode Session

Send a message to a different OpenCode session using the REST API. Two modes: inject context silently, or trigger the AI to act.

## When to Use

- Sending results, context, or follow-up instructions to another conversation
- Triggering work in a session running in a different terminal
- Injecting context a future session resumption will pick up

## Step 1: Find the Target Session

Use SQLite to search for the session. See `recover-opencode-conversation` skill for full query reference.

**By title:**
```bash
DB=$(opencode db path)
sqlite3 "$DB" \
  "SELECT id, title FROM session WHERE lower(title) LIKE '%keyword%' ORDER BY time_updated DESC LIMIT 5;"
```

**By message content:**
```bash
DB=$(opencode db path)
sqlite3 "$DB" \
  "SELECT DISTINCT s.id, s.title
   FROM part p JOIN message m ON p.message_id = m.id JOIN session s ON m.session_id = s.id
   WHERE lower(json_extract(p.data, '$.text')) LIKE '%keyword%'
   ORDER BY p.time_created DESC LIMIT 5;"
```

## Step 2: Discover a Running Server

Every OpenCode TUI runs a server on a random port. Find one:

```bash
OC_PORT=$(lsof -i -P -n 2>/dev/null | grep "opencode.*LISTEN" | head -1 | awk '{print $9}' | cut -d: -f2)
```

Verify it's alive:

```bash
curl -s "http://127.0.0.1:$OC_PORT/global/health"
# {"healthy":true,"version":"..."}
```

All servers share the same database, so any server can reach any session.

## Step 3: Push the Message

### Context injection (no AI response)

Injects a user message as context. The session sees it next time it's resumed.

```bash
curl -s -X POST "http://127.0.0.1:$OC_PORT/session/$SESSION_ID/message" \
  -H 'Content-Type: application/json' \
  -d '{
    "noReply": true,
    "parts": [{"type": "text", "text": "Here is some context from another session..."}]
  }'
```

### Trigger work (AI responds)

Sends a prompt and the AI processes it asynchronously. Does not block the caller.

```bash
curl -s -X POST "http://127.0.0.1:$OC_PORT/session/$SESSION_ID/prompt_async" \
  -H 'Content-Type: application/json' \
  -d '{
    "parts": [{"type": "text", "text": "Please do X based on the context above."}]
  }'
```

Use the synchronous endpoint if you need to wait for the response:

```bash
curl -s -X POST "http://127.0.0.1:$OC_PORT/session/$SESSION_ID/message" \
  -H 'Content-Type: application/json' \
  -d '{
    "parts": [{"type": "text", "text": "Do something and tell me the result."}]
  }'
```

## Common Mistakes

**Pushing to the wrong session** — always verify the session ID by checking its title and recent messages before sending. Use `curl -s "http://127.0.0.1:$OC_PORT/session/$SESSION_ID" | python3 -c "import sys,json; s=json.load(sys.stdin); print(s['title'])"` to confirm.

**Server not found** — if `lsof` returns nothing, no OpenCode instance is running. Start one with `opencode serve` or open a TUI.

**Session is actively running** — if the target session has an in-progress AI response, your message will be queued. The `prompt_async` endpoint won't fail, but timing matters.
