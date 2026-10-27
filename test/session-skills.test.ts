import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin, {
  buildLaunchArgv,
  describeError,
  jumpPromptText,
  jumpQuery,
  launchDirectory,
  listProjects,
  loadSkills,
  opencodeDbPath,
  parseFrontmatter,
  searchSessions,
  SKILLS_DIR,
  type SessionMatch,
} from "../index.ts"

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

describe("searchSessions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "session-skills-"))
  const db = makeDb(root)
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
})

function makeDb(root: string, name = "test.db"): string {
  const file = path.join(root, name)
  const db = new Database(file)
  db.run("CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT, time_active INTEGER, time_archived INTEGER)")
  db.run(
    "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_updated INTEGER)",
  )
  db.run("CREATE TABLE session_message (session_id TEXT, seq INTEGER, type TEXT, data TEXT)")
  db.run("INSERT INTO project VALUES ('p1', ?, 2, NULL), ('p2', '/other', 5, NULL), ('p3', '/archived', NULL, 1)", [root])

  const sessions: Array<[string, string | null, string, string, number]> = [
    ["s1", null, root, "Herdr layout", 300],
    ["s2", null, root, "Other", 200],
    ["s3", null, root, "Third", 100],
    ["s4", null, root, "Fourth", 400],
    ["s5", "s2", root, "Herdr child", 500],
    ["s6", null, "/does/not/exist", "herdr in a removed worktree", 50],
    ["s7", null, root, "Seventh", 150],
  ]
  for (const [id, parent, directory, title, updated] of sessions) {
    db.run("INSERT INTO session_v2 VALUES (?, 'p1', ?, ?, ?, ?)", [id, parent, directory, title, updated])
  }

  const messages: Array<[string, string, unknown]> = [
    ["s2", "user", { text: 'Search results for "herdr" are ready (1 found).' }],
    ["s2", "user", { text: "we discussed the herdr workspace flow in detail" }],
    ["s3", "synthetic", { text: "pushed context that mentions herdr panes" }],
    ["s4", "assistant", { content: [{ type: "text", text: "herdr everywhere" }] }],
    ["s7", "user", { text: "it's the herdr thing we talked about yesterday" }],
  ]
  messages.forEach(([sessionId, type, data], seq) => {
    db.run("INSERT INTO session_message VALUES (?, ?, ?, ?)", [sessionId, seq, type, JSON.stringify(data)])
  })
  db.close()
  return file
}

describe("buildLaunchArgv", () => {
  test("only passes flags the V2 TUI has", () => {
    expect(buildLaunchArgv("/p", "ses_1", "hi")).toEqual(["opencode", "--session", "ses_1", "--prompt", "hi", "/p"])
    expect(buildLaunchArgv("/p")).toEqual(["opencode", "/p"])
  })
})

describe("/jump", () => {
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
})

describe("launchDirectory", () => {
  test("returns the preferred directory when it exists, else the fallback", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "session-skills-"))
    expect(launchDirectory(dir, "/fallback")).toBe(dir)
    expect(launchDirectory(path.join(dir, "gone"), "/fallback")).toBe("/fallback")
  })
})

describe("opencodeDbPath", () => {
  test("follows XDG_DATA_HOME at call time", () => {
    withEnv("XDG_DATA_HOME", "/xdg", () => expect(opencodeDbPath()).toBe(path.join("/xdg", "opencode", "opencode.db")))
    withEnv("XDG_DATA_HOME", undefined, () =>
      expect(opencodeDbPath()).toBe(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")),
    )
  })
})

describe("describeError", () => {
  test("prefers message, then _tag, then String()", () => {
    expect(describeError(new Error("boom"))).toBe("boom")
    expect(describeError(Object.assign(new Error(""), { _tag: "SessionNotFound" }))).toBe("SessionNotFound")
    expect(describeError("plain")).toBe("plain")
    expect(describeError(null)).toBe("null")
    expect(describeError(undefined)).toBe("undefined")
  })
})

describe("plugin setup", () => {
  test("pick cache is per session, and /jump with no query sends the ask text", async () => {
    const xdg = mkdtempSync(path.join(os.tmpdir(), "session-skills-xdg-"))
    mkdirSync(path.join(xdg, "opencode"))
    makeDb(path.join(xdg, "opencode"), "opencode.db")

    await withEnvAsync("XDG_DATA_HOME", xdg, async () => {
      const { tools, commands, prompts } = await runSetup()
      const search = tools.get("project_search")!
      const jump = tools.get("project_jump")!

      const found = (await search.execute({ query: "herdr" }, { sessionID: "sA" })).content
      expect(found.startsWith("[{")).toBe(true)

      const other = await jump.execute({ pick: 1 }, { sessionID: "sB" })
      expect(other.content).toBe("Invalid pick: 1. Last search had 0 results.")

      await commands.get("jump")!.execute({ sessionID: "sC", prompt: { text: "   " }, delivery: "steer" })
      expect(prompts.at(-1)?.text).toBe(jumpPromptText("", []))
      const empty = await jump.execute({ pick: 1 }, { sessionID: "sC" })
      expect(empty.content).toBe("Invalid pick: 1. Last search had 0 results.")
    })
  })

  test("/jump reports a failed search as the prompt text", async () => {
    const xdg = mkdtempSync(path.join(os.tmpdir(), "session-skills-xdg-"))
    await withEnvAsync("XDG_DATA_HOME", xdg, async () => {
      const { commands, prompts } = await runSetup()
      await commands.get("jump")!.execute({ sessionID: "sA", prompt: { text: "herdr" }, delivery: "steer" })
      expect(prompts.at(-1)?.text.startsWith("Search failed: ")).toBe(true)
    })
  })

  test("one rejected tool or command definition does not drop the others", async () => {
    const { tools, commands } = await runSetup({ rejectTool: "project_search", rejectCommand: "jump" })
    expect([...tools.keys()]).toEqual(["project_list", "project_jump", "session_push"])
    expect(commands.size).toBe(0)
  })
})

type Tool = { execute: (input: unknown, context: { sessionID: string }) => Promise<{ content: string }> }
type Command = {
  execute: (input: { sessionID: string; prompt: { text: string }; delivery: string }) => Promise<void>
}

async function runSetup(options: { rejectTool?: string; rejectCommand?: string } = {}) {
  const tools = new Map<string, Tool>()
  const commands = new Map<string, Command>()
  const prompts: Array<{ text: string }> = []
  const ctx = {
    skill: { transform: async (callback: (editor: { add: () => void }) => void) => callback({ add() {} }) },
    tool: {
      transform: async (callback: (editor: { add: (tool: Tool & { name: string }) => void }) => void) =>
        callback({
          add(tool) {
            if (tool.name === options.rejectTool) throw new Error("rejected")
            tools.set(tool.name, tool)
          },
        }),
    },
    command: {
      transform: async (callback: (editor: { add: (command: Command & { name: string }) => void }) => void) =>
        callback({
          add(command) {
            if (command.name === options.rejectCommand) throw new Error("rejected")
            commands.set(command.name, command)
          },
        }),
    },
    session: { prompt: async (input: { text: string }) => void prompts.push(input) },
  }
  await plugin.setup(ctx as unknown as Plugin.Context)
  return { tools, commands, prompts }
}

function withEnv(key: string, value: string | undefined, run: () => void) {
  const previous = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    run()
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
}

async function withEnvAsync(key: string, value: string, run: () => Promise<void>) {
  const previous = process.env[key]
  process.env[key] = value
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
}
