# OpenCode V2 port: design

Date: 2026-10-21. Status: draft for Adrian's review.

## Why

OpenCode V2 (2.1.2 installed) can't run V1 plugin code. The service log shows this plugin failing on every load with `Plugin must export a default definition with an id and an effect or setup function.` So `/jump`, the five tools and the four skills are all gone today.

This port rewrites the plugin against the V2 plugin API so the same workflows come back: find a past conversation across projects, open it in a new Herdr workspace or terminal (resume or fork, optionally in a given agent), and push context into another session.

Done means: in a fresh V2 session the four tools and four skills are available, `/jump <term>` finds V2 conversations and opens the chosen one in Herdr, and `session_push` lands messages in the target session.

## Decided with Adrian

1. V2 only. Tag the current commit (`228a061`) as `v1` for V1 users. No dual V1/V2 export.
2. Drop `project_sessions` and `project_jump`'s `closeCurrent`. Keep terminal detection based on `process.env`, with a `shortcut:` comment.
3. `session_push` delivers straight through the shared service. The file queue (`~/.local/share/opencode/push-queue`), its `fs.watch` watchers and the `session.created` subscription go away.

## Goals

- Tools with the same names and arguments as V1, minus `closeCurrent`: `project_search`, `project_list`, `project_jump`, `session_push`.
- `/jump <query>` registered by the plugin.
- Skills `session-db`, `session-recover`, `session-push` and `session-jump` registered by the plugin, with content updated for V2.
- No runtime dependencies. The plugin loads from the local checkout and from `opencode plugin add github:mormubis/opencode-session-skills`.
- A `typecheck` script and one test file.

## Non-goals

- V1 support. The `v1` tag covers it.
- Anything that needs the TUI process: the session picker, closing the current session, a `./tui` CLI plugin entrypoint, plugin RPC.
- Detecting the caller's actual terminal.
- Searching assistant replies, and searching the 722 V1 sessions that never got V2 rows.
- A linter, splitting the file into modules, refactoring the terminal helpers, publishing to npm.

## Anti-goals

These make the port a failure even if the tools technically work:

- Any write to `opencode.db`: no indexes, no schema changes, no read-write connections.
- An exception escaping `setup` or a transform callback. V2 disables the whole plugin when `skill.transform`'s editor throws (see the comment in superpowers' `.opencode/plugins/superpowers.js`, around line 315).
- Removed features left behind as tools or arguments that pretend to work.
- Breaking the Herdr jump flow Adrian uses daily.
- A runtime dependency that `opencode plugin add` would have to install.

## Facts the design rests on

All checked on this machine on 2026-10-21.

### Runtime

- Plugins run inside the shared background service (`opencode serve --service`). Its runtime is Bun 1.4.2, so `bun:sqlite`, `Bun.spawn`, `Bun.spawnSync` and `Bun.write` keep working.
- There is one plugin instance per location (`ctx.location.directory`).
- `process.env` is the service's env, frozen from whichever pane started the service. The service's `HERDR_PANE_ID` was `wT:p1` while this shell's was `w1W:p1`. `HERDR_ENV`, `TERM_PROGRAM` and `GHOSTTY_RESOURCES_DIR` matched, which is why env-based detection works for Adrian today.
- The global config entry for this repo (still under the V1 `plugin` key, which V2 accepts) resolves through `package.json` `main` to `.opencode/plugins/session-skills.ts`. The log shows 33 load attempts of that file across 4 service runs.
- V2 also auto-loads every `.ts`/`.js` file directly inside a discovered `.opencode/plugins/` directory. A test or helper file placed there would be loaded as a plugin whenever OpenCode runs in this repo.
- `bun` isn't installed. `BUN_BE_BUN=1 opencode test` runs `bun test` on the embedded runtime.

### Plugin API (`@opencode/plugin` 2.1.2 types)

- Default export `{ id, setup(ctx) }`. `setup` may return a cleanup function.
- `ctx.tool.transform`, `ctx.command.transform` and `ctx.skill.transform` take synchronous editor callbacks with `add(...)`.
- Types live in `@opencode/plugin` 2.1.2 under `dist/promise/` (`tool.d.ts`, `command.d.ts`, `skill.d.ts`, `session.d.ts`).
- Tool definition: `{ name, description, input: <JSON Schema>, execute(input, context) => Promise<{ content: string }> }`. `context` carries `sessionID` (the calling session), `agent`, `messageID`, `id` (the call id), `signal` and `progress`. Without a namespace option, tool names are used as given.
- Command definition: `{ name, description?, execute({ sessionID, prompt, delivery }) => Promise<void> }`. `prompt` is `{ text, files?, agents?, skills? }`. The matching HTTP route takes the command `name` and its `text` separately, so `prompt.text` should be the typed arguments alone. The executor submits a prompt itself through `ctx.session.prompt`.
- `Skill.Info` is `{ id, name, description?, autoinvoke?, path, content }`, with `id`, `name`, `path` and `content` required. `path` is the absolute path to `SKILL.md` and `content` the body without frontmatter. `editor.add` throws synchronously on a schema mismatch.
- Extra named exports next to the default are fine. `opencode-pty` exports named functions beside its default export and loads as active.
- `ctx.session` exposes `list`, `create`, `get`, `remove`, `switchAgent`, `switchModel`, `prompt`, `generate`, `command`, `compact`, `synthetic`, `interrupt`, `update`, `move`, `wait` and `context`. There is no `fork`, no `ctx.project` and nothing TUI-related.
- `ctx.session.prompt({ sessionID, text, delivery?, resume? })`. Per the API docs, `resume: false` admits the message without starting a turn. `delivery: "queue"` waits for the current turn to finish, while `"steer"` (the default) injects into it.
- `ctx.session.create({ agent?, location?: { directory } })` returns the new `SessionInfo`.

### Server API and CLI

- `POST /api/session/{id}/fork` with body `{ before? }` returns `{ data: Session.Info }`. It's reachable as `opencode api post /api/session/<id>/fork --data '{}'`, which prints JSON. `opencode api` finds the service the same way the TUI does.
- Reads work across projects: `GET /api/session/<id>` resolved a session from another project while running in this repo. Writes across projects are untested.
- `GET /api/session?search=` matches titles only.
- TUI flags: `--session/-s <id>`, `--prompt <text>` and a positional directory. There is no `--fork` or `--agent`. Only `opencode run` has those, and `run` is non-interactive.
- `opencode db` no longer exists. `opencode debug paths` prints the data dir, and the database is `<data>/opencode.db`.

### Database (read-only use)

- V2 writes `session_v2` and `session_message`. The legacy `session`, `message` and `part` tables get no new rows. Migration status is `completed`, yet 722 legacy sessions have no V2 row.
- `session_v2`: `id`, `project_id`, `parent_id`, `fork_session_id`, `directory`, `title` (never NULL in current data), `agent`, `time_created`, `time_updated`, `time_archived`.
- `session_message`: `id`, `session_id`, `type`, `seq`, `time_created`, `data` (JSON). `user` and `synthetic` rows keep their text in `$.text`. `assistant` rows keep a `$.content` array of `{ type: "text", text }` and `{ type: "tool", ... }` items. An index on `(session_id, type, seq)` exists.
- `project`: `id`, `worktree`, `name`, `time_active`, `time_archived`.
- Child (subagent) sessions have `parent_id` set. No forks exist in the DB yet, so whether a fork gets a `parent_id` is unknown.
- Timings on the real 12 GB database (146,634 messages): title-only search 3 ms. Titles plus user/synthetic text with `LIMIT 10`: 0.43 s warm, about 2.9 s cold. Assistant text through `json_each`: 22.6 s cold.

## Spike first

Three things are unverified, and each has a fallback. Check them before building the rest, using throwaway sessions.

1. Cross-project writes. From a plugin instance in one project, call `ctx.session.switchAgent`, `ctx.session.create({ location })` and `ctx.session.prompt` against a session or directory in another project. If `ctx` refuses one, make that call through `opencode api post` instead, spawned the same way as fork below.
2. The TUI honors a session's stored agent. Switch a throwaway session to `plan` through the API, then open it with `opencode -s <id> <dir>`. If the TUI ignores it, drop the `agent` argument from `project_jump` and from the `session-jump` skill, and report it. No silent no-op.
3. Fork from inside the service. Run the fork call from a tool `execute`. It must return without hanging, and `data.location.directory` should be the source session's directory.

## Design

### Layout

- The plugin stays in `.opencode/plugins/session-skills.ts`, and `package.json` `main` keeps pointing at it. V2 already resolves it there; only the code is wrong.
- `package.json`: version `2.0.0`. Drop the `@opencode-ai/plugin` dependency. Add devDependencies `@opencode/plugin` (`^2.1.2`, types only), `@types/bun` and `typescript`. Scripts: `"typecheck": "tsc --noEmit"` and `"test": "BUN_BE_BUN=1 opencode test"`.
- A root `tsconfig.json`: strict, `noEmit`, Bun types, covering `.opencode/plugins/session-skills.ts` and `test/`.
- A root `.gitignore` with `node_modules/`, since installing the devDependencies creates one.
- Tests live in `test/session-skills.test.ts`, never under `.opencode/plugins/`.

### Entrypoint

- The default export is a plain object, `{ id: "opencode-session-skills", async setup(ctx) { ... } }`, checked with `satisfies Plugin.Plugin` after `import type { Plugin } from "@opencode/plugin"`, like `~/.config/opencode/plugins/emily.ts`. Bun strips the type import, so nothing needs installing at runtime.
- `setup` does three things, in this order:
  1. Read `skills/*/SKILL.md` (path relative to the plugin file, as today) and parse the frontmatter. Then register each skill with `ctx.skill.transform`, wrapping every `editor.add` in try/catch and logging rejects.
  2. Register the four tools with `ctx.tool.transform`.
  3. Register `jump` with `ctx.command.transform`.
- Nothing long-lived remains, so `setup` returns no cleanup.
- `lastSearchResults` stays in the `setup` closure. `/jump`, `project_search` and `project_jump` for one session all run in the same location instance, so the `pick` cache keeps working.
- Frontmatter parsing is a small regex for single-line `key: value` pairs, with `// shortcut: single-line frontmatter values only, switch to a YAML parser if a skill needs multi-line values`.

### Tools

Inputs are JSON Schema objects with `additionalProperties: false`. Every `execute` returns `{ content: string }`. Output strings stay as in V1 unless noted.

`project_search({ query })`

- Same behavior as V1: run the search, cache the results, return the question options JSON plus the `pick` hint. It excludes `context.sessionID`.

`project_list()`

- Reads the `project` table: the worktree of every project with `time_archived IS NULL`, most recently active first. Same markdown output as V1.

`project_jump({ projectPath?, sessionId?, mode?, agent?, pick?, prompt? })`

1. `pick` resolves `projectPath` and `sessionId` from the cache. `projectPath` is the session's own `directory`.
2. A missing `projectPath` returns the V1 error string.
3. `mode: "fork"` with a `sessionId`: run `api post /api/session/<id>/fork --data '{}'` on `process.execPath`, the running opencode binary, so neither PATH nor the version can drift. Use async `Bun.spawn` and await it, never `Bun.spawnSync`. The CLI calls back into this same service, which can't answer while its event loop is blocked, so a sync spawn deadlocks. Parse the JSON, continue with `data.id`, and open `data.location.directory`. On failure, return an error string and open nothing.
4. With `agent` and a session id (resumed or forked), call `ctx.session.switchAgent({ sessionID, agent })`. With `agent` and no session id, call `ctx.session.create({ agent, location: { directory: projectPath } })` and continue with its id.
5. Build the argv: `opencode`, then `--session <id>` if there is one, then `--prompt <text>` if there is one (long prompts still go through the existing temp-file helper), then `projectPath`.
6. Call `openTerminal` as today. Return the V1 success and failure strings, without the `closeCurrent` branch.

`session_push({ sessionId, message, noReply? })`

- Calls `ctx.session.prompt({ sessionID: sessionId, text: message, delivery: "queue", resume: !noReply })`.
- The result string says whether a turn was started, and that a busy session handles the message after its current turn. Errors such as an unknown session id propagate as tool errors.
- New tool description: the message goes through the shared OpenCode service, so a TUI showing that session updates live. An idle session with `noReply: false` starts a turn in the background right away. `noReply: true` stores the message without a turn.

### `/jump` command

`ctx.command.transform` adds `{ name: "jump", description: "Search conversations across all projects and jump to one", execute }`.

`execute({ sessionID, prompt, delivery })`:

- The query is `prompt.text.trim()`. If `text` turns out to include the `/jump` prefix, strip it.
- Empty query: prompt the model to ask the user what to search for, then call `project_search`.
- No matches: send `No conversations found matching "<query>".`, as V1 does.
- Matches: send the V1 instruction text unchanged. It starts with `Search results for`, which the excerpt filter relies on.
- Send with `ctx.session.prompt({ ...prompt, sessionID, text, delivery })`.

### Search

- Use `bun:sqlite` with `new Database(path, { readonly: true })`, the same SQLite library the service uses. Never `immutable=1`: it skips the WAL and misses recent messages.
- `searchSessions(dbPath, keyword, excludeSessionId, limit)` takes the DB path so tests can point it at a fixture. The tool passes `~/.local/share/opencode/opencode.db`.
- The query:

```sql
SELECT s.id AS session_id, s.title, s.time_updated, s.directory,
  (SELECT substr(json_extract(m.data, '$.text'), 1, 200)
     FROM session_message m
    WHERE m.session_id = s.id
      AND m.type = 'user'
      AND length(json_extract(m.data, '$.text')) > 20
      AND lower(json_extract(m.data, '$.text')) LIKE ?1
      AND json_extract(m.data, '$.text') NOT LIKE 'Use the %tool%'
      AND json_extract(m.data, '$.text') NOT LIKE 'The user searched%'
      AND json_extract(m.data, '$.text') NOT LIKE 'Search results for%'
    ORDER BY m.seq
    LIMIT 1) AS excerpt
FROM session_v2 s
WHERE s.parent_id IS NULL
  AND (lower(s.title) LIKE ?1
       OR s.id IN (SELECT m.session_id FROM session_message m
                    WHERE m.type IN ('user', 'synthetic')
                      AND lower(json_extract(m.data, '$.text')) LIKE ?1))
ORDER BY s.time_updated DESC
LIMIT ?2
```

- V1's `(@... subagent)` title filter goes away, since `parent_id IS NULL` already removes subagent sessions.
- Assistant text is left out because it costs 22.6 s cold.
- The query is synchronous and blocks the shared service while it runs (0.43 s warm, about 3 s cold). Comment it with `// shortcut: bun:sqlite is synchronous, so a search blocks the shared service (~0.4s warm, ~3s cold on a 12 GB DB). Move it to a Bun Worker if that gets noticeable.`
- `projectName` comes from `projectDisplayName(directory)`.

### Terminal code

- Unchanged except: no `--fork` or `--agent` in the argv, no `closeCurrent` branch, and this comment above `openTerminal`: `// shortcut: process.env is the shared service's env, frozen from whichever terminal started it, not the caller's. Fine while every terminal runs Herdr in Ghostty. Move terminal launching into a CLI plugin if jumps open in the wrong place.`
- `Bun.spawnSync` stays for terminal launching. None of those commands wait on the service, so they can't deadlock. They block it briefly, but Herdr calls return in milliseconds and jumps are rare.

### Removed

- `project_sessions`, `closeCurrent` and every `client.tui.*` call.
- The push queue: `PUSH_QUEUE_DIR`, `QueuedMessage`, `processQueue`, `watchSession`, the startup `client.session.list()` loop, the `event` hook and the `watch` import.
- The V1 imports from `@opencode-ai/plugin` and `@opencode-ai/sdk`.

### Skills

Content edits only. IDs and directory names stay.

- `session-db`: locate the DB with `opencode debug paths`. Document `session_v2`, `session_message` and the message shapes above. Rewrite the queries for V2: recent sessions, title search, user-text search, and reading a conversation with assistant text through `json_each`. Run `sqlite3 -readonly`. Warn that searching assistant text is slow, and that the legacy tables only hold pre-V2 history.
- `session-recover`: drop `project_sessions` and use the V2 read query. A fork points at its source through `session_v2.fork_session_id`.
- `session-push`: rewrite "How real-time delivery works" with the semantics from the tool description above.
- `session-jump`: drop `project_sessions` and the `closeCurrent` section. In the bash fallback, resume stays `opencode -s <id> <path>`, and fork becomes `opencode api post /api/session/<id>/fork --data '{}'` followed by `opencode -s <new id> <path>`. Keep the warning against `opencode run`, reworded: it's non-interactive.

### README

- Install with `opencode plugin add github:mormubis/opencode-session-skills`. V1 users install the `v1` tag.
- Requirements: OpenCode 2.1 or later, plus `sqlite3` for the manual queries in `session-db`. Drop `curl` and `lsof`.
- One line each for the tools and `/jump`.

### Tests

`test/session-skills.test.ts`, run with `npm test`. It imports `searchSessions` and the frontmatter parser as named exports from the plugin file.

- The frontmatter parser reads all four real `SKILL.md` files: non-empty `name` and `description`, and a body without frontmatter.
- `searchSessions` runs against a temp-file DB with the minimal `session_v2` and `session_message` columns. It covers a title match, a user-text match and a synthetic-text match. It also checks that child sessions and the excluded id are skipped, that the excerpt comes from the first matching user message, and that results are newest first.

## Verification before calling it done

1. `npm run typecheck` and `npm test` pass.
2. The service log shows no `failed to load plugin` for this repo, and `opencode api get /api/plugin` lists `opencode-session-skills` as active.
3. `opencode api get /api/skill` lists the four skills, and a fresh session sees the four tools.
4. `/jump <term>` returns options for a V2 conversation. Picking one with resume opens a Herdr workspace on that session. A jump with `prompt` submits it as the first message.
5. Fork opens a new session that has `fork_session_id` set. If it also has a `parent_id`, include forks in the search filter (`parent_id IS NULL OR fork_session_id IS NOT NULL`).
6. `agent: "plan"` opens in Plan, both for an existing session and for a brand-new directory.
7. `session_push` to a throwaway session in another project: `noReply: true` stores the message without a turn, `noReply: false` runs a turn, and a push to a busy session waits until the current turn ends.
8. `project_search` takes under a second warm on the real DB.

## Outside this repo (each needs Adrian's OK)

- Delete `~/.config/opencode/commands/jump.md`, which would otherwise define a second `/jump`.
- `git tag v1 228a061`, then push the tag.
- Optional: move the repo path in `~/.config/opencode/opencode.json` from `plugin` to `plugins`. V2 already reads the V1 key, so nothing depends on it.

## Left to the builder

- Wording of tool descriptions, skill prose and error strings.
- Test structure and fixture data.
- tsconfig details, as long as typecheck passes over the whole plugin file. Type fixes in untouched helpers are fine if behavior doesn't change.
- Whether to filter `excludeSessionId` in SQL instead of after the `LIMIT`, as V1 does.
- Commit structure for the port. This spec is committed on its own.

## Calls made without Adrian (check these)

- The file stays in `.opencode/plugins/`. The plan in chat said to move it to a root `index.ts`, but the log shows its location was never the problem.
- Plugin id `opencode-session-skills`, version `2.0.0`.
- Jumps open the session's own directory, not its project root.
- Search covers titles plus user and synthetic text, runs synchronously in the service, and leaves out assistant text.
- `project_list` reads the `project` table directly.
- Fork goes through an `opencode api` subprocess on `process.execPath`, spawned async.
- Spike fallbacks: `opencode api` for any cross-project write `ctx` refuses, and dropping `agent` if the TUI ignores a session's stored agent.
- `session_push` uses `delivery: "queue"`.
- A session created or forked by `project_jump` isn't cleaned up if the terminal fails to open.
- `/jump` with no arguments asks the user what to search for.
- Tests run through `BUN_BE_BUN=1 opencode test`.

## Spike results

- Cross-project writes: works. Create (with `agent` and `location.directory` of another project), `POST /agent` and `POST /prompt` all succeeded against a session in `opencode-kagi-search`. Caveat: the queued prompt (`delivery: "queue"`, `resume: false`) returned a `user` message but it did not appear in `GET /api/session/$ID/message` 10 seconds later. That list only held the `agent-switched` entry, so no `user` and no `assistant`. It may be pending until a turn runs, which `session_push` needs to account for.
- TUI shows a session's stored agent: yes (Adrian opened the session with `opencode -s $ID <dir>` and the indicator showed Plan).
- Fork: `data.location.directory` equals the source's (the kagi path). `data.parentID` is not set (`null`). The link is in `data.fork.sessionID` (equals the source id), with `data.fork.boundary` `{type: "through", messageID: <source's last listed message>}`.
