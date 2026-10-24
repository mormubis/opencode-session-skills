---
name: session-recover
description: Use when the user asks to find, recall, or recover a past OpenCode conversation — e.g. "we talked about X earlier", "find that session from this morning", "what did we decide about Y last week"
---

# Recover OpenCode Conversation

Find and read past OpenCode conversations. Uses `session-db` skill for schema and queries.

## Quick Reference

| Signal | Action |
|--------|--------|
| "we talked about X" | `project_search` or SQLite content search |
| "session from this morning" | SQLite with `time_updated` filter |
| "what did we decide" | Read full conversation content |

## Find a Session

Use `project_search` first. Fall back to SQLite (via `session-db` skill) when you need content search or time filtering.

### Built-in tools

```
project_search({ query: "keyword" })   # Search across all projects
project_list()                          # List known projects
```

### SQLite

See `session-db` skill for all queries — search by title, message content, or time range.

## Read Conversation Content

Use the "Read conversation content" query from the `session-db` skill, which includes assistant text.

## Common Mistakes

**Wrong session identified** — verify session content before summarizing. Title alone is not reliable.

**Forked sessions share history** — a forked session has the same early messages as the original, and `session_v2.fork_session_id` points at its source. Check `time_created` to confirm you have the right one.
