# OpenCode V2 Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make opencode-session-skills load and work as an OpenCode V2 plugin: four tools, `/jump` and four skills, reading the V2 database and calling V2 APIs.

**Architecture:** The plugin stays one file at `.opencode/plugins/session-skills.ts` and keeps its terminal helpers. Its default export becomes a V2 `{ id, setup }` object that registers skills, tools and the `jump` command through `ctx.*.transform`. Search reads `session_v2` and `session_message` read-only with `bun:sqlite`, writes go through `ctx.session`, and fork goes through the `opencode api` CLI, spawned async.

**Tech Stack:** TypeScript on Bun 1.4.2 (embedded in OpenCode 2.1.2), `bun:sqlite`, `bun:test`, types from `@opencode/plugin` 2.1.2.

**Spec:** `docs/superpowers/specs/2026-10-21-opencode-v2-port-design.md`

## Global Constraints

- V2 only. The default export is `{ id: "opencode-session-skills", setup(ctx) }`. No V1 `server()` export, no imports from `@opencode-ai/plugin` or `@opencode-ai/sdk`.
- No runtime dependencies. `@opencode/plugin` (`^2.1.2`) is imported with `import type` only.
- The plugin stays at `.opencode/plugins/session-skills.ts`, and `package.json` `main` keeps pointing at it. Nothing else goes under `.opencode/plugins/`: V2 loads every `.ts`/`.js` file there as a plugin.
- Package version `2.0.0`.
- DB access is read-only: `new Database(path, { readonly: true })` from `bun:sqlite`. Never `immutable=1`, never a write.
- No exception may escape `setup` or a transform callback. Each skill `editor.add` gets its own try/catch.
- Calls back into the service (`opencode api`) run `process.execPath` through async `Bun.spawn`, never `Bun.spawnSync`, which deadlocks.
- Tool inputs are JSON Schema objects with `additionalProperties: false`, declared `as const` as in `~/workspace/opencode-kagi-search/src/index.ts`. Every `execute` returns `{ content: string }`.
- Comments only for `shortcut:` notes and non-obvious reasons, matching the file's current density.
- "V1's ..." below means the code at `git show 228a061:.opencode/plugins/session-skills.ts`. Reuse its wording unless a step says otherwise.
- The global config loads this checkout's file in every OpenCode location, and V2 reloads it on save. Work in this checkout on branch `v2-port`, not in a separate worktree, which OpenCode wouldn't load. Run `npm test` and `npm run typecheck` before every live check.
- Nothing gets pushed (branch or tag) and nothing outside the repo changes without Adrian's OK. Run `npm run typecheck` before any push.

## Review Focus

1. A session whose directory no longer exists, such as a removed worktree: `project_jump` opens the project root instead of failing. Test in Task 3.
2. A keyword with quotes (`it's`): search matches and never errors. Test in Task 3.
3. A `SKILL.md` with CRLF line endings, or a colon inside a value: name and description still parse. Test in Task 2.
4. `/jump` with no arguments or only whitespace: the model asks what to search for, and nothing searches for an empty string. Test in Task 6.
5. A push to a session id that doesn't exist: a readable tool error, with nothing else affected. Check in Task 5.

## Files

| File | Responsibility |
|---|---|
| `.opencode/plugins/session-skills.ts` | The whole plugin: entrypoint, skill loading, search, terminal launching, tools, `/jump`. Stays one file. |
| `test/session-skills.test.ts` | `bun:test` unit tests and the fixture DB. |
| `skills/*/SKILL.md` | Skill content, updated for V2 in the task that changes the matching tool. |
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` | Types, typecheck and tests. |
| `README.md` | Install and requirements. |
| The spec | Gets a `## Spike results` section in Task 1, which Tasks 3 to 5 read. |

---

### Task 1: Spike the unknowns

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-opencode-v2-port-design.md` (append `## Spike results`)

**Interfaces:**
- Produces: a `## Spike results` section with three lines.
  - Cross-project writes: "works", or the failing call and its error.
  - Whether the TUI shows a session's stored agent: yes or no.
  - Fork: whether `data.location.directory` equals the source's, and whether `data.parentID` is set.

The plugin context uses the same client contract as `opencode api`, so these calls stand in for `ctx.session.*`. Run them from the repo root against `/Users/adrian.delarosa/workspace/opencode-kagi-search`, which is another project.

- [ ] **Step 1: Create the branch**

Run: `git switch -c v2-port`
Expected: `Switched to a new branch 'v2-port'`

- [ ] **Step 2: Create a throwaway session in another project, with an agent**

Run: `opencode api post /api/session --data '{"title":"spike: v2 port (delete me)","agent":"plan","location":{"directory":"/Users/adrian.delarosa/workspace/opencode-kagi-search"}}' | jq '{id: .data.id, dir: .data.location.directory, agent: .data.agent}'`
Expected: an `id`, `dir` equal to the kagi path and `agent` equal to `"plan"`. Keep the id as `$ID`.

- [ ] **Step 3: Check that the TUI shows the stored agent**

Ask Adrian to run `opencode -s $ID /Users/adrian.delarosa/workspace/opencode-kagi-search` in a new pane, say whether the agent indicator shows Plan, and quit.
Expected: Adrian's answer, recorded as yes or no.

- [ ] **Step 4: Switch the agent across projects**

Run: `opencode api post /api/session/$ID/agent --data '{"agent":"build"}' && opencode api get /api/session/$ID | jq -r .data.agent`
Expected: `build`

- [ ] **Step 5: Push without starting a turn, across projects**

Run: `opencode api post /api/session/$ID/prompt --data '{"text":"spike message, no reply expected","delivery":"queue","resume":false}'`. Wait 10 seconds, then run `opencode api get /api/session/$ID/message | jq '[.data[].type]'`.
Expected: the list contains `"user"` and no `"assistant"`.

- [ ] **Step 6: Fork**

Run: `opencode api post /api/session/$ID/fork --data '{}' | jq '{id: .data.id, dir: .data.location.directory, parent: .data.parentID, fork: .data.fork.sessionID}'`
Expected: a new `id`, and `fork` equal to `$ID`. Record `dir` and `parent`, and keep the new id as `$FORK`.

- [ ] **Step 7: Delete both sessions, fork first**

Run: `opencode api delete /api/session/$FORK && opencode api delete /api/session/$ID && opencode api get /api/session/$ID`
Expected: both deletes succeed and the final get fails with not found.

- [ ] **Step 8: Record the results**

Append `## Spike results` to the spec with the three lines from the Interfaces block. If any call in Steps 2, 4 or 5 failed, stop and report to Adrian before Task 2, because it changes `session_push` and `agent`.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-10-21-opencode-v2-port-design.md
git commit -m "docs: record V2 port spike results"
```

---

### Task 2: Load as a V2 plugin and register the skills

**Files:**
- Modify: `.opencode/plugins/session-skills.ts`: header comment (lines 1-9), imports (11-18), delete the PUSH QUEUE section (583-645), replace the PLUGIN section (647-882)
- Modify: `package.json`
- Create: `tsconfig.json`, `.gitignore`, `test/session-skills.test.ts`

**Interfaces:**
- Produces:
  - `export const SKILLS_DIR: string`, equal to `path.resolve(__dirname, "../../skills")`
  - `export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string }`
  - `export interface SkillEntry { id: string; name: string; description?: string; path: string; content: string }`
  - `export async function loadSkills(skillsDir: string): Promise<SkillEntry[]>`
  - `export default { id: "opencode-session-skills", async setup(ctx) { ... } } satisfies Plugin.Plugin`. Later tasks add code inside this `setup`.

- [ ] **Step 1: Set up the tooling**

- `package.json`: version `2.0.0`. Keep `name`, `type` and `main`, remove `dependencies`, and add `"scripts": { "typecheck": "tsc --noEmit", "test": "BUN_BE_BUN=1 opencode test" }`.
- Run `npm install -D @opencode/plugin@^2.1.2 @types/bun typescript`. If its OpenTUI or Solid peer dependencies fail to install, add `--legacy-peer-deps`: only the types are needed.
- `tsconfig.json`: `strict`, `noEmit`, `skipLibCheck`, `allowImportingTsExtensions`, `target: "ESNext"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `types: ["bun"]`, and `include: [".opencode/plugins/session-skills.ts", "test/**/*.ts"]`.
- `.gitignore`: `node_modules/`.

Expected: `npm install` succeeds and `package-lock.json` exists.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test"
import * as path from "node:path"
import { loadSkills, parseFrontmatter, SKILLS_DIR } from "../.opencode/plugins/session-skills.ts"

describe("parseFrontmatter", () => {
  test("splits single-line pairs from the body", () => {
    expect(parseFrontmatter("---\nname: a\ndescription: b\n---\n# T\n")).toEqual({
      data: { name: "a", description: "b" },
      body: "# T\n",
    })
  })

  test("keeps colons inside values", () => {
    expect(parseFrontmatter("---\ndescription: Use when X: do Y\n---\nbody").data.description).toBe("Use when X: do Y")
  })

  test("handles CRLF line endings", () => {
    const { data, body } = parseFrontmatter("---\r\nname: a\r\ndescription: b\r\n---\r\nbody\r\n")
    expect(data).toEqual({ name: "a", description: "b" })
    expect(body.trim()).toBe("body")
  })

  test("returns everything as body without frontmatter", () => {
    expect(parseFrontmatter("# T\ntext")).toEqual({ data: {}, body: "# T\ntext" })
  })
})

describe("loadSkills", () => {
  test("loads the four bundled skills", async () => {
    const skills = await loadSkills(SKILLS_DIR)
    expect(skills.map((skill) => skill.id).sort()).toEqual(["session-db", "session-jump", "session-push", "session-recover"])
    for (const skill of skills) {
      expect(skill.name).toBe(skill.id)
      expect(skill.description?.length).toBeGreaterThan(20)
      expect(skill.path).toBe(path.join(SKILLS_DIR, skill.id, "SKILL.md"))
      expect(skill.content.startsWith("---")).toBe(false)
    }
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL, because the named exports don't exist yet.

- [ ] **Step 4: Replace the V1 wiring**

- Imports: drop `tool` and `Plugin` from `@opencode-ai/plugin`, the `@opencode-ai/sdk` types and `watch`. Add `import type { Plugin } from "@opencode/plugin"`.
- Delete the PUSH QUEUE section, and V1's `SessionSkillsPlugin` with its `export default`. The other helpers stay untouched for now.
- `parseFrontmatter`: a regex for an optional leading `---` block with `\r?\n` line breaks. Each line splits at its first `:` and both sides get trimmed. Add `// shortcut: single-line frontmatter values only, switch to a YAML parser if a skill needs multi-line values`.
- `loadSkills`: every non-hidden directory in `skillsDir` that holds a `SKILL.md` becomes `{ id: dir, name: data.name || dir, description: data.description, path, content: body }`, leaving out `description` when it's empty.
- `setup`: call `loadSkills(SKILLS_DIR)`, logging and falling back to `[]` on error. Then one `ctx.skill.transform` adds each skill in its own try/catch. If the branded `Skill.Info` type rejects plain strings, cast at the `editor.add` call.
- Header comment: V2, the four tools, `/jump` and the four skills.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: 5 tests pass and no type errors. Type errors in untouched helpers get fixed without changing behavior.

- [ ] **Step 6: Check that OpenCode loads it**

Run: `opencode reload`, then `opencode api get /api/plugin | jq -r '.data[].id' | grep opencode-session-skills`, then `opencode api get /api/skill | jq -r '.data[].id' | grep '^session-'`
Expected: `opencode-session-skills`, then the four skill ids. No new `failed to load plugin` line for this repo in `~/.local/share/opencode/log/opencode.log`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .opencode/plugins/session-skills.ts test/session-skills.test.ts
git commit -m "feat: load as a V2 plugin and register skills"
```

---

### Task 3: Search V2 sessions

**Files:**
- Modify: `.opencode/plugins/session-skills.ts`: the SESSION SEARCH section (`SessionMatch`, `searchSessions`), a new `listProjects`, and `setup`
- Modify: `skills/session-db/SKILL.md`, `skills/session-recover/SKILL.md`
- Test: `test/session-skills.test.ts`

**Interfaces:**
- Consumes: `setup` from Task 2, and the fork line of the spike results.
- Produces:
  - `export const OPENCODE_DB: string` (same value, now exported)
  - `export interface SessionMatch { sessionId: string; title: string; timeUpdated: number; excerpt: string; projectPath: string; projectName: string }`
  - `export function searchSessions(dbPath: string, keyword: string, excludeSessionId?: string, limit = 10): SessionMatch[]`
  - `export function listProjects(dbPath: string): string[]`
  - In `setup`: `let lastSearchResults: SessionMatch[] = []`, and one `ctx.tool.transform` callback with `project_search` and `project_list`. Tasks 4 and 5 add their tools to this callback.

- [ ] **Step 1: Write the failing tests**

Add a `makeDb()` helper that writes a temp-file DB with only the columns the queries read, and returns its path. `root` is an existing temp directory (`mkdtempSync`).

- `project`: `p1` with worktree `root` and `time_active` 2, `p2` with worktree `/other` and `time_active` 5, `p3` with worktree `/archived` and `time_archived` 1.
- `session_v2` and `session_message`, all in `p1`. Messages are listed in `seq` order. User and synthetic `data` is `{ "text": ... }`.

| id | parent_id | directory | title | time_updated | messages |
|---|---|---|---|---|---|
| s1 | | root | `Herdr layout` | 300 | |
| s2 | | root | `Other` | 200 | user `Search results for "herdr" are ready (1 found).`, then user `we discussed the herdr workspace flow in detail` |
| s3 | | root | `Third` | 100 | synthetic `pushed context that mentions herdr panes` |
| s4 | | root | `Fourth` | 400 | assistant with `content: [{ "type": "text", "text": "herdr everywhere" }]` |
| s5 | s2 | root | `Herdr child` | 500 | |
| s6 | | `/does/not/exist` | `herdr in a removed worktree` | 50 | |
| s7 | | root | `Seventh` | 150 | user `it's the herdr thing we talked about yesterday` |

```ts
const ids = (matches: SessionMatch[]) => matches.map((match) => match.sessionId)

test("matches titles, user and synthetic text, newest first", () => {
  expect(ids(searchSessions(db, "HERDR"))).toEqual(["s1", "s2", "s7", "s3", "s6"])
})

test("excludes a session in SQL so the limit stays full", () => {
  expect(ids(searchSessions(db, "herdr", "s1", 2))).toEqual(["s2", "s7"])
})

test("takes the excerpt from the first matching user message, skipping injected search prompts", () => {
  const byId = Object.fromEntries(searchSessions(db, "herdr").map((match) => [match.sessionId, match]))
  expect(byId.s2.excerpt).toBe("we discussed the herdr workspace flow in detail")
  expect(byId.s1.excerpt).toBe("")
})

test("falls back to the project root when the session directory is gone", () => {
  const [match] = searchSessions(db, "removed worktree")
  expect(match.projectPath).toBe(root)
  expect(match.projectName).toBe(root.split(path.sep).filter(Boolean).slice(-2).join("/"))
})

test("binds keywords with quotes", () => {
  expect(ids(searchSessions(db, "it's"))).toEqual(["s7"])
})

test("listProjects returns live worktrees, most recently active first", () => {
  expect(listProjects(db)).toEqual(["/other", root])
})
```

If the spike recorded that forks get a `parentID`, add `s8` (parent `s1`, `fork_session_id` `s1`, title `herdr fork`, `time_updated` 250) and expect it in the first test between `s1` and `s2`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL, because `searchSessions` still takes V1's arguments and `listProjects` doesn't exist.

- [ ] **Step 3: Implement search and the two tools**

- `searchSessions`: the spec's SQL with three changes.
  - Add `LEFT JOIN project p ON p.id = s.project_id`, selecting `p.worktree AS project_root`.
  - Add `AND s.id IS NOT ?3`, binding `null` when there's nothing to exclude.
  - If the spike recorded fork parents, the root filter becomes `(s.parent_id IS NULL OR s.fork_session_id IS NOT NULL)`.
- `projectPath` is the session `directory` when it exists on disk, else `project_root`. `projectName` is `projectDisplayName(projectPath)`. Put the spec's blocking `shortcut:` comment above the query.
- `listProjects`: `SELECT worktree FROM project WHERE time_archived IS NULL ORDER BY time_active DESC`.
- Tools: port V1's `project_search` and `project_list` into the transform, calling `searchSessions(OPENCODE_DB, query, context.sessionID)` and `listProjects(OPENCODE_DB)`. `project_search`'s description says it searches titles and user messages.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Time it on the real DB**

Run this twice: `BUN_BE_BUN=1 opencode -e 'import { OPENCODE_DB, searchSessions } from "./.opencode/plugins/session-skills.ts"; const t = performance.now(); console.log(searchSessions(OPENCODE_DB, "herdr").length, Math.round(performance.now() - t) + "ms")'`
Expected: a non-zero count, and the second run under 1000ms.

- [ ] **Step 6: Update `session-db` and `session-recover`**

Follow the spec's Skills section. Every SQL block in `session-db` must run with `sqlite3 -readonly ~/.local/share/opencode/opencode.db "<query>"` (add `LIMIT 3` where there's none) and return rows without an error.

Run: `grep -nE "opencode db path|project_sessions|FROM part|JOIN message" skills/session-db/SKILL.md skills/session-recover/SKILL.md`
Expected: no output.

- [ ] **Step 7: Check it live**

Run `opencode reload`, then call `project_search` with `herdr` from a session.
Expected: options JSON listing recent V2 conversations.

- [ ] **Step 8: Commit**

```bash
git add .opencode/plugins/session-skills.ts test/session-skills.test.ts skills/session-db/SKILL.md skills/session-recover/SKILL.md
git commit -m "feat: search V2 sessions and list projects"
```

---

### Task 4: Jump on V2

**Files:**
- Modify: `.opencode/plugins/session-skills.ts`: `buildLaunchArgv`, a comment above `openTerminal`, new `opencodeApi` and `forkSession`, and `project_jump` in the tool transform
- Modify: `skills/session-jump/SKILL.md`
- Test: `test/session-skills.test.ts`

**Interfaces:**
- Consumes: `lastSearchResults` and the tool transform from Task 3, and the agent and cross-project lines of the spike results.
- Produces:
  - `export function buildLaunchArgv(projectPath: string, sessionId?: string, prompt?: string): string[]`
  - `async function opencodeApi(apiPath: string, body: Record<string, unknown>): Promise<any>`. It runs `process.execPath api post <apiPath> --data <json>` through async `Bun.spawn`, throws with stderr on a non-zero exit, and returns the parsed `data`, or `undefined` when stdout is empty (204 responses).
  - `async function forkSession(sessionId: string): Promise<{ id: string; directory: string }>`

- [ ] **Step 1: Write the failing test**

```ts
test("buildLaunchArgv only passes flags the V2 TUI has", () => {
  expect(buildLaunchArgv("/p", "ses_1", "hi")).toEqual(["opencode", "--session", "ses_1", "--prompt", "hi", "/p"])
  expect(buildLaunchArgv("/p")).toEqual(["opencode", "/p"])
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL, because `buildLaunchArgv` isn't exported and still takes `mode` and `agent`.

- [ ] **Step 3: Implement**

- `buildLaunchArgv` with the new signature.
- `opencodeApi`, with a one-line comment saying why it can't be sync. `forkSession` returns `{ id: data.id, directory: data.location.directory }`.
- `project_jump`: port V1's tool without `closeCurrent`, following the spec's six steps. A fork failure returns `Failed to fork session <id>: <error>` and opens nothing.
- If the spike says the TUI ignores the stored agent, drop `agent` from the schema and the flow.
- If a `ctx.session` call fails across projects in Step 6, switch that call to `opencodeApi` with the same body.
- Add the spec's `shortcut:` comment above `openTerminal`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Update `session-jump`**

Follow the spec's Skills section.

Run: `grep -nE "project_sessions|closeCurrent|--fork" skills/session-jump/SKILL.md`
Expected: no output.

- [ ] **Step 6: Check it live, with Adrian watching the screen**

After `opencode reload`, from a session:

1. Call `project_search` for a term, then `project_jump({ pick: 1 })`.
   Expected: a Herdr workspace opens on that session.
2. Call `project_jump({ pick: 1, mode: "fork" })`.
   Expected: it returns within a few seconds, and a workspace opens on a new session. Running `sqlite3 -readonly ~/.local/share/opencode/opencode.db "SELECT id, fork_session_id FROM session_v2 WHERE fork_session_id IS NOT NULL ORDER BY time_created DESC LIMIT 1"` shows the source as its `fork_session_id`.
3. Call `project_jump({ pick: 1, agent: "plan" })`, then `project_jump({ projectPath: "<a new directory from mktemp -d>", agent: "plan" })`.
   Expected: both open in Plan.
4. Call `project_jump({ pick: 1, prompt: "Reply with OK." })`.
   Expected: the prompt is sent as the first message.

- [ ] **Step 7: Commit**

```bash
git add .opencode/plugins/session-skills.ts test/session-skills.test.ts skills/session-jump/SKILL.md
git commit -m "feat: port project_jump to V2"
```

---

### Task 5: Push on V2

**Files:**
- Modify: `.opencode/plugins/session-skills.ts`: `session_push` in the tool transform
- Modify: `skills/session-push/SKILL.md`

**Interfaces:**
- Consumes: the tool transform from Task 3, the cross-project line of the spike results, and `opencodeApi` from Task 4 as the fallback.

- [ ] **Step 1: Implement `session_push`**

- Inputs: `sessionId` (string, required), `message` (string, required), `noReply` (boolean).
- `execute` calls `ctx.session.prompt({ sessionID: sessionId, text: message, delivery: "queue", resume: !noReply })`. It returns `Message stored in session <id> without starting a turn.` when `noReply` is set. Otherwise it returns `Message sent to session <id>. It starts a turn now, or after the current one if the session is busy.`
- The description comes from the spec. Errors propagate.

- [ ] **Step 2: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 3: Check it live with a throwaway session in another project**

1. Run `opencode api post /api/session --data '{"title":"push test (delete me)","location":{"directory":"/Users/adrian.delarosa/workspace/opencode-kagi-search"}}' | jq -r .data.id` and keep the id as `$ID`.
2. Call `session_push({ sessionId: $ID, message: "context only", noReply: true })`.
   Expected: after 10 seconds, `opencode api get /api/session/$ID/message | jq '[.data[].type]'` shows the user message and no assistant message.
3. Call `session_push({ sessionId: $ID, message: "Count from 1 to 20, one number per line." })`, then right away `session_push({ sessionId: $ID, message: "Reply with DONE." })`.
   Expected: the second user message comes after the first reply finishes.
4. Call `session_push({ sessionId: "ses_doesnotexist", message: "x" })`.
   Expected: a tool error naming the missing session, and other sessions keep working.
5. If `ctx.session.prompt` failed across projects, switch to `opencodeApi(`/api/session/${sessionId}/prompt`, { text, delivery, resume })` and repeat 2 to 4.
6. Run `opencode api delete /api/session/$ID`.

- [ ] **Step 4: Update `session-push`**

Follow the spec's Skills section.

Run: `grep -nE "push-queue|fs\.watch|promptAsync|SSE" skills/session-push/SKILL.md`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/session-skills.ts skills/session-push/SKILL.md
git commit -m "feat: push messages through the V2 service"
```

---

### Task 6: `/jump` command

**Files:**
- Modify: `.opencode/plugins/session-skills.ts`: new `jumpQuery` and `jumpPromptText`, and `ctx.command.transform` in `setup`
- Test: `test/session-skills.test.ts`

**Interfaces:**
- Consumes: `searchSessions`, `OPENCODE_DB`, `SessionMatch` and `lastSearchResults` from Task 3, plus the existing `buildQuestionOptions`.
- Produces:
  - `export function jumpQuery(text: string): string`, which strips a leading `/jump` and trims
  - `export function jumpPromptText(query: string, matches: SessionMatch[]): string`

- [ ] **Step 1: Write the failing tests**

```ts
test("jumpQuery strips the command and whitespace", () => {
  expect(jumpQuery("  herdr  ")).toBe("herdr")
  expect(jumpQuery("/jump herdr")).toBe("herdr")
  expect(jumpQuery("   ")).toBe("")
})

test("jumpPromptText asks for a query when there is none", () => {
  const text = jumpPromptText("", [])
  expect(text).toContain("project_search")
  expect(text).not.toContain("No conversations found")
})

test("jumpPromptText reports no matches", () => {
  expect(jumpPromptText("zzz", [])).toBe('No conversations found matching "zzz".')
})

test("jumpPromptText starts with Search results for, so excerpts skip it", () => {
  const match: SessionMatch = { sessionId: "s1", title: "T", timeUpdated: Date.now(), excerpt: "", projectPath: "/p", projectName: "p" }
  const text = jumpPromptText("herdr", [match])
  expect(text.startsWith('Search results for "herdr"')).toBe(true)
  expect(text).toContain("project_jump")
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test`
Expected: FAIL, because `jumpQuery` and `jumpPromptText` don't exist.

- [ ] **Step 3: Implement**

- `jumpPromptText`: for matches, V1's text from its `command.execute.before` hook, unchanged. For no matches, the string in the test. For an empty query, tell the model to ask the user what to search for, then call `project_search`.
- The command has `name: "jump"` and `description: "Search conversations across all projects and jump to one"`.
- Its `execute` takes `jumpQuery(prompt.text)`. Only for a non-empty query does it search (excluding `sessionID`) and store the results in `lastSearchResults`. It then sends `ctx.session.prompt({ ...prompt, sessionID, text: jumpPromptText(query, matches), delivery })`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Remove the old command file**

Ask Adrian to OK deleting `~/.config/opencode/commands/jump.md`, which defines a second `/jump`. Delete it once he agrees.

- [ ] **Step 6: Check it live**

After `opencode reload`, in a session:

1. `/jump herdr`
   Expected: the question tool lists conversations, and picking one with resume opens it.
2. `/jump`
   Expected: the model asks what to search for.
3. `/jump zzqqxx`
   Expected: `No conversations found matching "zzqqxx".`

- [ ] **Step 7: Commit**

```bash
git add .opencode/plugins/session-skills.ts test/session-skills.test.ts
git commit -m "feat: register /jump as a V2 command"
```

---

### Task 7: README and release

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

Follow the spec's README section: install command, a note on the `v1` tag, requirements (OpenCode 2.1 or later, `sqlite3` for the `session-db` queries), and one line each for the four tools and `/jump`.

- [ ] **Step 2: Re-run the checks**

Run: `npm test && npm run typecheck`, then the two commands from Task 2 Step 6.
Expected: everything passes, the plugin is active and all four skills are listed.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for V2"
```

- [ ] **Step 4: Ask Adrian before anything public**

Ask about each of these, and do only what he approves:

- `git tag v1 228a061 && git push origin v1`
- merging `v2-port` into `main` and pushing it
- moving the repo path in `~/.config/opencode/opencode.json` from `plugin` to `plugins`
