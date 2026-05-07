---
name: opencode-session-management
description: Use when finding, reading, jumping to, or pushing messages into OpenCode sessions. Covers searching past conversations, injecting context or triggering work in another session, and resuming or forking sessions across projects.
---

# OpenCode Session Management

Find, read, jump to, and push messages into OpenCode sessions.

## Find a Session

### Via SQLite (powerful search)

Database path: `opencode db path` (default `~/.local/share/opencode/opencode.db`)

| Table     | Key columns                                                          |
| --------- | -------------------------------------------------------------------- |
| `session` | `id`, `title`, `time_created` (ms), `time_updated` (ms)              |
| `message` | `id`, `session_id`, `time_created` (ms), `data` (JSON)               |
| `part`    | `id`, `message_id`, `session_id`, `time_created` (ms), `data` (JSON) |

`part.data` is a JSON blob. Text content lives at `$.text` when `$.type = 'text'`. Tool call inputs live at `$.input`.

Timestamps are **milliseconds** since epoch. Convert with: `datetime(time_created/1000, 'unixepoch', 'localtime')`

**List recent sessions:**
```sql
SELECT id, title,
  datetime(time_created/1000, 'unixepoch', 'localtime') as created,
  datetime(time_updated/1000, 'unixepoch', 'localtime') as updated
FROM session ORDER BY time_updated DESC LIMIT 20;
```

**Search by title:**
```sql
SELECT id, title, datetime(time_created/1000, 'unixepoch', 'localtime')
FROM session WHERE lower(title) LIKE '%keyword%'
ORDER BY time_updated DESC;
```

**Search message content:**
```sql
SELECT DISTINCT s.id, s.title,
  datetime(s.time_created/1000, 'unixepoch', 'localtime') as created
FROM part p
JOIN message m ON p.message_id = m.id
JOIN session s ON m.session_id = s.id
WHERE (lower(json_extract(p.data, '$.text')) LIKE '%keyword%'
    OR lower(json_extract(p.data, '$.input')) LIKE '%keyword%')
ORDER BY p.time_created DESC;
```

**Filter by time range:**
```sql
-- Add to any WHERE clause:
AND datetime(p.time_created/1000, 'unixepoch', 'localtime') >= '2026-03-25 00:00:00'
```

### Via built-in tools

```
project_search({ query: "keyword" })   # Search across all projects
project_list()                          # Browse projects and recent sessions
project_sessions()                      # Interactive session picker UI
```

## Read Conversation Content

```sql
SELECT json_extract(p.data, '$.text')
FROM part p
JOIN message m ON p.message_id = m.id
WHERE m.session_id = 'SESSION_ID'
  AND json_extract(p.data, '$.type') = 'text'
ORDER BY p.time_created;
```

## Jump to a Session

Opens the session in a new terminal.

```
project_jump({
  projectPath: "/path/to/project",
  sessionId: "ses_abc123",
  mode: "resume"   // or "fork"
})
```

| Mode | Behavior |
|------|----------|
| `resume` | Continues the session. New messages append to the existing conversation. |
| `fork` | Creates a copy. The original stays untouched. |

If the session might be active in another terminal, use `fork` to avoid conflicts.

## Push a Message to a Session

### Discover a running server

Every OpenCode instance runs a server on a random port. Any server can reach any session (shared database).

```bash
OC_PORT=$(lsof -i -P -n 2>/dev/null | grep "opencode.*LISTEN" | head -1 | awk '{print $9}' | cut -d: -f2)
curl -s "http://127.0.0.1:$OC_PORT/global/health"
```

### Context injection (no AI response)

Injects a user message as context. The session sees it next time it's resumed.

```bash
curl -s -X POST "http://127.0.0.1:$OC_PORT/session/$SESSION_ID/message" \
  -H 'Content-Type: application/json' \
  -d '{
    "noReply": true,
    "parts": [{"type": "text", "text": "Context from another session..."}]
  }'
```

### Trigger work (AI responds)

Sends a prompt asynchronously. Does not block the caller.

```bash
curl -s -X POST "http://127.0.0.1:$OC_PORT/session/$SESSION_ID/prompt_async" \
  -H 'Content-Type: application/json' \
  -d '{
    "parts": [{"type": "text", "text": "Please do X based on the context above."}]
  }'
```

Use `/session/$SESSION_ID/message` (without `noReply`) for the synchronous variant that waits for the AI response.

## Common Mistakes

**"This morning" may not match `time_created`** — sessions span multiple days. Check both `time_created` and `time_updated`.

**Title search misses content** — search `part.data` content too. Run both queries in parallel.

**Wrong session identified** — verify the session content before acting. Title alone is not reliable.

**Pushing to the wrong session** — confirm with `curl -s "http://127.0.0.1:$OC_PORT/session/$SESSION_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['title'])"`.

**Server not found** — if `lsof` returns nothing, start one with `opencode serve` or open a TUI.

**Session is actively running** — messages to active sessions are queued. Timing matters with `prompt_async`.
