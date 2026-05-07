# opencode-session-skills

Agent skills for managing OpenCode sessions. Find past conversations, push messages between sessions, and jump to conversations in other projects.

## Skills

| Skill | Description |
|-------|-------------|
| `recover-opencode-conversation` | Search and read past OpenCode conversations via SQLite |
| `push-message-to-session` | Send messages or context to another session via REST API |
| `jump-to-conversation` | Open another session in a new terminal (resume or fork) |

## Install

Symlink the skills directory into your OpenCode config:

```bash
ln -s /path/to/opencode-session-skills/skills/* ~/.config/opencode/skills/
```

Or for a single skill:

```bash
ln -s /path/to/opencode-session-skills/skills/push-message-to-session ~/.config/opencode/skills/
```

Skills are discovered automatically on the next OpenCode session.

## Requirements

- [OpenCode](https://opencode.ai) v1.0+
- `sqlite3` (for session search)
- `curl` and `lsof` (for push-message-to-session)

## License

MIT
