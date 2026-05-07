---
name: recover-opencode-conversation
description: Use when the user asks to find, recall, or recover a past OpenCode conversation — e.g. "we talked about X earlier", "find that session from this morning", "what did we decide about Y last week"
---

# Recover OpenCode Conversation

## Overview

OpenCode persists all conversations in a local SQLite database. Query it directly with `sqlite3` to find sessions by title, date, or message content.

## Database Location

Discover the path with:

```bash
opencode db path
```

Default: `~/.local/share/opencode/opencode.db`

## Schema Quick Reference

| Table     | Key columns                                                          |
| --------- | -------------------------------------------------------------------- |
| `session` | `id`, `title`, `time_created` (ms), `time_updated` (ms)              |
| `message` | `id`, `session_id`, `time_created` (ms), `data` (JSON)               |
| `part`    | `id`, `message_id`, `session_id`, `time_created` (ms), `data` (JSON) |

`part.data` is a JSON blob. Text content lives at `$.text` when `$.type = 'text'`. Tool call inputs live at `$.input`.

Timestamps are **milliseconds** since epoch. Convert with: `datetime(time_created/1000, 'unixepoch', 'localtime')`

## Queries

**List recent sessions:**

```sql
SELECT id, title,
  datetime(time_created/1000, 'unixepoch', 'localtime') as created,
  datetime(time_updated/1000, 'unixepoch', 'localtime') as updated
FROM session ORDER BY time_updated DESC LIMIT 20;
```

**Search sessions by title keyword:**

```sql
SELECT id, title, datetime(time_created/1000, 'unixepoch', 'localtime')
FROM session WHERE lower(title) LIKE '%keyword%'
ORDER BY time_updated DESC;
```

**Search message content (text + tool inputs):**

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

**Get conversation content from a session:**

```sql
SELECT json_extract(p.data, '$.text')
FROM part p
JOIN message m ON p.message_id = m.id
WHERE m.session_id = 'SESSION_ID'
  AND json_extract(p.data, '$.type') = 'text'
ORDER BY p.time_created;
```

**Filter by time range (e.g. today only):**

```sql
-- Add to any WHERE clause:
AND datetime(p.time_created/1000, 'unixepoch', 'localtime') >= '2026-03-25 00:00:00'
```

## Common Mistakes

**"This morning" may not match `time_created`** — sessions often span multiple days. A session created days ago but still active this morning will have an old `time_created` but a recent `time_updated`. Always check both.

**Title search misses content** — if the session title doesn't mention the topic, search `part.data` content too. Run both queries in parallel.

**Wrong session identified** — check the session content with the full-text query before summarizing. The title alone is not reliable.
