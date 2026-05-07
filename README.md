# opencode-session-skills

Agent skills for managing OpenCode sessions. Find past conversations, push messages between sessions, and jump to conversations in other projects.

## Skills

| Skill | Description |
|-------|-------------|
| `session-db` | Shared reference for the OpenCode SQLite schema and common queries |
| `session-recover` | Search and read past OpenCode conversations |
| `session-push` | Send messages or context to another session via REST API |
| `session-jump` | Open another session in a new terminal (resume or fork) |

## Install

```bash
opencode plug github:mormubis/opencode-session-skills --global
```

Skills are discovered automatically on the next OpenCode session.

## Requirements

- [OpenCode](https://opencode.ai) v1.0+
- `sqlite3` (for session search)
- `curl` and `lsof` (for pushing messages)

## License

MIT
