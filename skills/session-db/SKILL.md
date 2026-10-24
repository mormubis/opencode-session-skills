---
name: session-db
description: Use when querying the OpenCode SQLite database — looking up sessions, searching message content, or converting timestamps. Shared reference for schema and queries.
---

# OpenCode Database Reference

Sessions and messages live in a single SQLite database. Timestamps are milliseconds — always divide by 1000. Open it read-only: `sqlite3 -readonly <db> "<query>"`.

## Database Location

```bash
opencode debug paths
```

Look for the `db` line. Default: `~/.local/share/opencode/opencode.db`

## Schema

| Table             | Key columns                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `session_v2`      | `id`, `project_id`, `parent_id`, `fork_session_id`, `directory`, `title`, `time_created` (ms), `time_updated` (ms) |
| `session_message` | `session_id`, `seq`, `type`, `time_created` (ms), `data` (JSON)                                 |
| `project`         | `id`, `worktree`, `time_active` (ms), `time_archived` (ms)                                      |

`parent_id` is set on subagent sessions. A fork points at its source through `fork_session_id`.

Message `type` and `data` shapes:

| `type`       | `data`                                                              |
| ------------ | ------------------------------------------------------------------- |
| `user`       | `{ "text": ... }`                                                   |
| `synthetic`  | `{ "text": ... }` (pushed or injected context)                      |
| `assistant`  | `{ "content": [{ "type": "text", "text": ... }, ...] }`             |

Other types (`system`, `shell`, `compaction`, `idle`, ...) carry no conversation text.

The legacy `session`, `message` and `part` tables only hold history from before V2. Don't use them for recent work.

## Quick Reference

| Goal | Query target |
|------|-------------|
| Find session by title | `session_v2.title LIKE '%x%'` |
| Search what the user wrote | `json_extract(data, '$.text')` on `session_message` where `type IN ('user', 'synthetic')` |
| Read full conversation | `session_message` WHERE `session_id` ORDER BY `seq`, assistant text via `json_each` |
| Filter by date | `datetime(time_created/1000, 'unixepoch', 'localtime')` |

## Common Queries

**List recent sessions:**
```sql
SELECT id, title, directory,
  datetime(time_created/1000, 'unixepoch', 'localtime') as created,
  datetime(time_updated/1000, 'unixepoch', 'localtime') as updated
FROM session_v2 WHERE parent_id IS NULL
ORDER BY time_updated DESC LIMIT 20;
```

**Search by title:**
```sql
SELECT id, title, directory, datetime(time_updated/1000, 'unixepoch', 'localtime')
FROM session_v2 WHERE parent_id IS NULL AND lower(title) LIKE '%keyword%'
ORDER BY time_updated DESC LIMIT 20;
```

**Search user text:**
```sql
SELECT s.id, s.title, s.directory,
  datetime(s.time_updated/1000, 'unixepoch', 'localtime') as updated
FROM session_v2 s
WHERE s.parent_id IS NULL
  AND s.id IN (
    SELECT m.session_id FROM session_message m
    WHERE m.type IN ('user', 'synthetic')
      AND lower(json_extract(m.data, '$.text')) LIKE '%keyword%'
  )
ORDER BY s.time_updated DESC LIMIT 20;
```

**Read conversation content:**
```sql
SELECT m.seq, m.type,
  CASE m.type
    WHEN 'assistant' THEN (
      SELECT group_concat(json_extract(c.value, '$.text'), char(10))
      FROM json_each(m.data, '$.content') c
      WHERE json_extract(c.value, '$.type') = 'text')
    ELSE json_extract(m.data, '$.text')
  END AS text
FROM session_message m
WHERE m.session_id = 'SESSION_ID' AND m.type IN ('user', 'synthetic', 'assistant')
ORDER BY m.seq LIMIT 50;
```

## Common Mistakes

**Using timestamps directly** — they're milliseconds, not seconds. Always `time_created/1000`.

**Title-only search** — titles are often empty or generic. Search user text too. Run both queries in parallel.

**Searching assistant text across all sessions** — it's very slow (tens of seconds on a large database). Find the session through titles and user text first, then read its assistant text with the conversation query.

**Assuming `time_created` = last activity** — sessions span days. A "this morning" session may have `time_created` from last week. Check `time_updated` too.

**Forgetting `parent_id IS NULL`** — subagent sessions otherwise show up as separate conversations.
