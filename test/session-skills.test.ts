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
