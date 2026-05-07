---
name: session-db
description: Use when querying the OpenCode SQLite database — looking up sessions, searching message content, or converting timestamps. Shared reference for schema and queries.
---

# OpenCode Database Reference

All sessions, messages, and parts live in a single SQLite database. Timestamps are milliseconds — always divide by 1000.

## Database Location

```bash
opencode db path
```

Default: `~/.local/share/opencode/opencode.db`

## Schema

| Table     | Key columns                                                |
| --------- | ---------------------------------------------------------- |
| `session` | `id`, `title`, `time_created` (ms), `time_updated` (ms)   |
| `message` | `id`, `session_id`, `time_created` (ms), `data` (JSON)    |
| `part`    | `id`, `message_id`, `session_id`, `time_created` (ms), `data` (JSON) |

`part.data` is JSON. Text: `$.text` when `$.type = 'text'`. Tool inputs: `$.input`.

## Quick Reference

| Goal | Query target |
|------|-------------|
| Find session by title | `session.title LIKE '%x%'` |
| Search message content | `json_extract(part.data, '$.text')` |
| Read full conversation | `part` JOIN `message` WHERE `session_id` |
| Filter by date | `datetime(time_created/1000, 'unixepoch', 'localtime')` |

## Common Queries

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
-- Searches both user/AI text and tool call arguments
SELECT DISTINCT s.id, s.title,
  datetime(s.time_created/1000, 'unixepoch', 'localtime') as created
FROM part p
JOIN message m ON p.message_id = m.id
JOIN session s ON m.session_id = s.id
WHERE (lower(json_extract(p.data, '$.text')) LIKE '%keyword%'
    OR lower(json_extract(p.data, '$.input')) LIKE '%keyword%')
ORDER BY p.time_created DESC;
```

**Read conversation content:**
```sql
SELECT json_extract(p.data, '$.text')
FROM part p
JOIN message m ON p.message_id = m.id
WHERE m.session_id = 'SESSION_ID'
  AND json_extract(p.data, '$.type') = 'text'
ORDER BY p.time_created;
```

## Common Mistakes

**Using timestamps directly** — they're milliseconds, not seconds. Always `time_created/1000`.

**Title-only search** — titles are often empty or generic. Search `part.data` content too. Run both queries in parallel.

**Assuming `time_created` = last activity** — sessions span days. A "this morning" session may have `time_created` from last week. Check `time_updated` too.
