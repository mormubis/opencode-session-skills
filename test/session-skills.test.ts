import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  buildLaunchArgv,
  jumpPromptText,
  jumpQuery,
  listProjects,
  loadSkills,
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

function makeDb(root: string): string {
  const file = path.join(root, "test.db")
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
