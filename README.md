# opencode-session-skills

Agent skill for managing OpenCode sessions. Find past conversations, read their content, push messages between sessions, and jump to conversations across projects.

## Install

Clone the repo and symlink the skill into your OpenCode config:

```bash
git clone https://github.com/mormubis/opencode-session-skills.git
ln -s "$(pwd)/opencode-session-skills/skills/opencode-session-management" ~/.config/opencode/skills/
```

The skill is discovered automatically on the next OpenCode session.

## What it does

- **Find sessions** — search by title, message content, or time range via SQLite, or use built-in tools (`project_search`, `project_list`)
- **Read conversations** — pull the full text content of any past session
- **Jump to sessions** — open a session in a new terminal, resume or fork it
- **Push messages** — inject context silently (`noReply`) or trigger AI work in another session via the REST API

## Requirements

- [OpenCode](https://opencode.ai) v1.0+
- `sqlite3` (for session search)
- `curl` and `lsof` (for pushing messages)

## License

MIT
