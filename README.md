# opencode-session-skills

An OpenCode plugin for managing sessions. Find past conversations, push messages between sessions, and jump to conversations in other projects.

## Install

```bash
opencode plugin add github:mormubis/opencode-session-skills
```

Tools, the `/jump` command and the skills load on the next OpenCode session.

This version targets the OpenCode V2 plugin API. For OpenCode 1.x, install the `v1` tag, the last V1 version.

## Tools

| Tool | Description |
|------|-------------|
| `project_search` | Search sessions across all projects by keyword, matching titles and user messages |
| `project_list` | List all known OpenCode projects |
| `project_jump` | Open a new terminal at a project, optionally resuming or forking a session, in a chosen agent |
| `session_push` | Send a message to another session. With `noReply: true`, it joins the conversation on that session's next turn |

## Commands

| Command | Description |
|---------|-------------|
| `/jump <query>` | Search sessions across all projects and jump to one |

## Skills

| Skill | Description |
|-------|-------------|
| `session-db` | Shared reference for the OpenCode SQLite schema and common queries |
| `session-recover` | Search and read past OpenCode conversations |
| `session-push` | Send messages or context to another session |
| `session-jump` | Open another session in a new terminal or Herdr workspace (resume or fork) |

## Requirements

- [OpenCode](https://opencode.ai) 2.1 or later
- `sqlite3`, for the manual queries in `session-db`

## License

MIT
