/**
 * Session Skills Plugin for OpenCode (V2)
 *
 * Provides tools for searching, listing, and jumping between
 * OpenCode sessions across all projects, a /jump command, and
 * session-related skills.
 *
 * Tools: project_search, project_list, project_jump, session_push
 * Command: /jump
 * Skills: session-jump, session-push, session-db, session-recover
 */

import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const OPENCODE_DB = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")

// =============================================================================
// SHELL ESCAPING
// =============================================================================

function escapeBash(str: string): string {
	return str
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\$/g, "\\$")
		.replace(/`/g, "\\`")
		.replace(/!/g, "\\!")
		.replace(/\n/g, " ")
		.replace(/\r/g, " ")
}

function escapeAppleScript(str: string): string {
	return str
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, " ")
		.replace(/\r/g, " ")
}

function escapeBatch(str: string): string {
	return str
		.replace(/%/g, "%%")
		.replace(/\^/g, "^^")
		.replace(/&/g, "^&")
		.replace(/</g, "^<")
		.replace(/>/g, "^>")
		.replace(/\|/g, "^|")
}

// =============================================================================
// TERMINAL — SHARED HELPERS
// =============================================================================

interface TerminalResult {
	success: boolean
	error?: string
}

function buildBashCommand(argv: string[]): string | undefined {
	if (argv.length === 0) return undefined
	return argv.map((arg) => `"${escapeBash(arg)}"`).join(" ")
}

function buildScriptContent(cwd: string, argv: string[]): string {
	const escapedCwd = escapeBash(cwd)
	const command = buildBashCommand(argv)
	const body = command
		? `cd "${escapedCwd}" || exit 1\n${command}\nexec $SHELL`
		: `cd "${escapedCwd}"\nexec $SHELL`
	return `#!/bin/bash\ntrap 'rm -f "$0"' EXIT INT TERM\n${body}`
}

async function writeTempScript(content: string, ext = ".sh"): Promise<string> {
	const scriptPath = path.join(
		os.tmpdir(),
		`session-jump-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
	)
	await Bun.write(scriptPath, content)
	await fs.chmod(scriptPath, 0o755)
	return scriptPath
}

// =============================================================================
// TERMINAL — TMUX
// =============================================================================

async function openTmuxWindow(
	cwd: string,
	argv: string[],
	windowName?: string,
): Promise<TerminalResult> {
	const tmuxArgs = ["new-window", "-n", windowName || "opencode", "-c", cwd]

	if (argv.length > 0) {
		const scriptPath = await writeTempScript(buildScriptContent(cwd, argv))
		tmuxArgs.push("--", "bash", scriptPath)
	}

	const result = Bun.spawnSync(["tmux", ...tmuxArgs])
	if (result.exitCode !== 0) {
		return { success: false, error: `tmux: ${result.stderr.toString()}` }
	}
	return { success: true }
}

// =============================================================================
// TERMINAL — MACOS (AppleScript-based, runs in user's default shell)
// =============================================================================

type MacTerminal = "ghostty" | "iterm" | "kitty" | "alacritty" | "warp" | "terminal"

function shellQuote(str: string): string {
	return `'${str.replace(/'/g, "'\\''")}'`
}

function detectMacTerminal(): MacTerminal {
	if (process.env.GHOSTTY_RESOURCES_DIR) return "ghostty"
	if (process.env.ITERM_SESSION_ID) return "iterm"
	if (process.env.KITTY_WINDOW_ID) return "kitty"
	if (process.env.ALACRITTY_WINDOW_ID) return "alacritty"
	if (process.env.__CFBundleIdentifier === "dev.warp.Warp-Stable") return "warp"

	const tp = process.env.TERM_PROGRAM?.toLowerCase()
	if (tp === "ghostty") return "ghostty"
	if (tp === "iterm.app") return "iterm"
	if (tp === "warpterm") return "warp"

	return "terminal"
}

function buildShellCommand(cwd: string, argv: string[]): string {
	const cdPart = `cd ${shellQuote(cwd)}`
	if (argv.length === 0) return cdPart
	const cmd = argv.map((a) => shellQuote(a)).join(" ")
	return `${cdPart} && ${cmd}`
}

function runAppleScript(script: string): TerminalResult {
	const result = Bun.spawnSync(["osascript", "-e", script])
	if (result.exitCode !== 0) {
		return { success: false, error: result.stderr.toString() }
	}
	return { success: true }
}

async function openMacOSTerminal(cwd: string, argv: string[]): Promise<TerminalResult> {
	const terminal = detectMacTerminal()
	const command = buildShellCommand(cwd, argv)
	const escapedCommand = escapeAppleScript(command)

	try {
		switch (terminal) {
			case "iterm": {
				return runAppleScript(`
					tell application "iTerm2"
						activate
						tell current window
							create tab with default profile
							tell current session
								write text "${escapedCommand}"
							end tell
						end tell
					end tell`)
			}

			case "kitty": {
				// Try remote control first (requires allow_remote_control in kitty.conf)
				const remote = Bun.spawnSync([
					"kitty", "@", "launch", "--type", "tab", "--cwd", cwd,
					"--", "sh", "-c", `${command}; exec $SHELL`,
				])
				if (remote.exitCode === 0) return { success: true }

				// Fallback: AppleScript
				return runAppleScript(`
					tell application "kitty"
						activate
					end tell
					delay 0.3
					tell application "System Events"
						tell process "kitty"
							keystroke "t" using command down
							delay 0.3
							keystroke "${escapedCommand}"
							key code 36
						end tell
					end tell`)
			}

			case "warp": {
				return runAppleScript(`
					tell application "Warp"
						activate
					end tell
					delay 0.3
					tell application "System Events"
						tell process "Warp"
							keystroke "t" using command down
							delay 0.3
							keystroke "${escapedCommand}"
							key code 36
						end tell
					end tell`)
			}

			case "ghostty": {
				return runAppleScript(`
					tell application "Ghostty"
						activate
					end tell
					delay 0.3
					tell application "System Events"
						tell process "Ghostty"
							keystroke "t" using command down
							delay 0.3
							keystroke "${escapedCommand}"
							key code 36
						end tell
					end tell`)
			}

			case "alacritty": {
				// Alacritty has no native tab support; open a new window
				return runAppleScript(`
					tell application "Alacritty"
						activate
					end tell
					delay 0.3
					tell application "System Events"
						tell process "Alacritty"
							keystroke "n" using command down
							delay 0.3
							keystroke "${escapedCommand}"
							key code 36
						end tell
					end tell`)
			}

			default: {
				return runAppleScript(`
					tell application "Terminal"
						activate
						do script "${escapedCommand}"
					end tell`)
			}
		}
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) }
	}
}

// =============================================================================
// TERMINAL — LINUX
// =============================================================================

async function openLinuxTerminal(cwd: string, argv: string[]): Promise<TerminalResult> {
	const scriptPath = await writeTempScript(buildScriptContent(cwd, argv))

	const terminals: Array<{ name: string; args: string[] }> = [
		{ name: "kitty", args: ["kitty", "--directory", cwd, "-e", "bash", scriptPath] },
		{
			name: "alacritty",
			args: ["alacritty", "--working-directory", cwd, "-e", "bash", scriptPath],
		},
		{ name: "ghostty", args: ["ghostty", "-e", "bash", scriptPath] },
		{
			name: "gnome-terminal",
			args: ["gnome-terminal", "--working-directory", cwd, "--", "bash", scriptPath],
		},
		{ name: "konsole", args: ["konsole", "--workdir", cwd, "-e", "bash", scriptPath] },
		{ name: "xterm", args: ["xterm", "-e", "bash", scriptPath] },
	]

	for (const { name, args } of terminals) {
		const check = Bun.spawnSync(["which", name])
		if (check.exitCode !== 0) continue

		try {
			const proc = Bun.spawn(args, {
				detached: true,
				stdio: ["ignore", "ignore", "ignore"],
			})
			proc.unref()
			return { success: true }
		} catch {
			continue
		}
	}

	try {
		await fs.rm(scriptPath)
	} catch {}
	return { success: false, error: "No terminal emulator found" }
}

// =============================================================================
// TERMINAL — WINDOWS
// =============================================================================

async function openWindowsTerminal(cwd: string, argv: string[]): Promise<TerminalResult> {
	const command = argv.length > 0 ? argv.map((a) => `"${escapeBatch(a)}"`).join(" ") : undefined
	const body = command
		? `cd /d "${escapeBatch(cwd)}"\r\n${command}\r\ncmd /k`
		: `cd /d "${escapeBatch(cwd)}"\r\ncmd /k`
	const scriptContent = `@echo off\r\n${body}\r\n(goto) 2>nul & del "%~f0"`
	const scriptPath = await writeTempScript(scriptContent, ".bat")

	const wtCheck = Bun.spawnSync(["where", "wt"], { stdout: "pipe", stderr: "pipe" })
	if (wtCheck.exitCode === 0) {
		try {
			const proc = Bun.spawn(["wt.exe", "-d", cwd, "cmd", "/k", scriptPath], {
				detached: true,
				stdio: ["ignore", "ignore", "ignore"],
			})
			proc.unref()
			return { success: true }
		} catch {}
	}

	try {
		const proc = Bun.spawn(["cmd", "/c", "start", "", scriptPath], {
			detached: true,
			stdio: ["ignore", "ignore", "ignore"],
		})
		proc.unref()
		return { success: true }
	} catch (error) {
		try {
			await fs.rm(scriptPath)
		} catch {}
		return { success: false, error: error instanceof Error ? error.message : String(error) }
	}
}

// =============================================================================
// TERMINAL — HERDR
// =============================================================================

// Herdr (https://herdr.dev) manages its own workspaces/tabs/panes on top of
// whatever terminal it's running in. When present, prefer its socket API over
// faking keystrokes into the underlying terminal — that keeps the new pane
// inside Herdr's layout instead of spawning an untracked tab next to it.
async function openHerdrWorkspace(
	cwd: string,
	argv: string[],
	label?: string,
): Promise<TerminalResult> {
	const createArgs = ["herdr", "workspace", "create", "--cwd", cwd, "--focus"]
	if (label) createArgs.push("--label", label)

	const created = Bun.spawnSync(createArgs)
	if (created.exitCode !== 0) {
		return { success: false, error: `herdr workspace create: ${created.stderr.toString()}` }
	}

	let paneId: string
	try {
		paneId = JSON.parse(created.stdout.toString()).result.root_pane.pane_id
	} catch {
		return {
			success: false,
			error: `herdr workspace create: could not read pane_id from response: ${created.stdout.toString()}`,
		}
	}

	if (argv.length === 0) return { success: true }

	// pane run sends command text + Enter into the pane's shell, so build one
	// already-quoted line rather than trusting herdr to re-escape each arg.
	const run = Bun.spawnSync(["herdr", "pane", "run", paneId, buildShellCommand(cwd, argv)])
	if (run.exitCode !== 0) {
		return { success: false, error: `herdr pane run: ${run.stderr.toString()}` }
	}
	return { success: true }
}

// =============================================================================
// TERMINAL — UNIFIED ENTRY POINT
// =============================================================================

// shortcut: process.env is the shared service's env, frozen from whichever terminal started it, not the caller's. Fine while every terminal runs Herdr in Ghostty. Move terminal launching into a CLI plugin if jumps open in the wrong place.
async function openTerminal(
	cwd: string,
	argv?: string[],
	windowName?: string,
): Promise<TerminalResult> {
	const normalizedArgv = argv ?? []

	if (process.env.HERDR_ENV === "1") {
		return openHerdrWorkspace(cwd, normalizedArgv, windowName)
	}

	if (process.env.TMUX) {
		return openTmuxWindow(cwd, normalizedArgv, windowName)
	}

	switch (process.platform) {
		case "darwin":
			return openMacOSTerminal(cwd, normalizedArgv)
		case "linux":
			return openLinuxTerminal(cwd, normalizedArgv)
		case "win32":
			return openWindowsTerminal(cwd, normalizedArgv)
		default:
			return { success: false, error: `Unsupported platform: ${process.platform}` }
	}
}

// =============================================================================
// SESSION SEARCH
// =============================================================================

export interface SessionMatch {
	sessionId: string
	title: string
	timeUpdated: number
	excerpt: string
	projectPath: string
	projectName: string
}

export function searchSessions(
	dbPath: string,
	keyword: string,
	excludeSessionId?: string,
	limit = 10,
): SessionMatch[] {
	const db = new Database(dbPath, { readonly: true })

	try {
		const lowerKeyword = `%${keyword.toLowerCase()}%`

		// shortcut: bun:sqlite is synchronous, so a search blocks the shared service (~0.4s warm, ~3s cold on a 12 GB DB). Move it to a Bun Worker if that gets noticeable.
		const rows = db
			.query<
				{
					session_id: string
					title: string | null
					time_updated: number
					directory: string
					project_root: string | null
					excerpt: string | null
				},
				[string, number, string | null]
			>(
				`
			SELECT
				s.id AS session_id,
				s.title,
				s.time_updated,
				s.directory,
				p.worktree AS project_root,
				(
					SELECT substr(json_extract(m.data, '$.text'), 1, 200)
					FROM session_message m
					WHERE m.session_id = s.id
						AND m.type = 'user'
						AND length(json_extract(m.data, '$.text')) > 20
						AND lower(json_extract(m.data, '$.text')) LIKE ?1
						AND json_extract(m.data, '$.text') NOT LIKE 'Use the %tool%'
						AND json_extract(m.data, '$.text') NOT LIKE 'The user searched%'
						AND json_extract(m.data, '$.text') NOT LIKE 'Search results for%'
					ORDER BY m.seq
					LIMIT 1
				) AS excerpt
			FROM session_v2 s
			LEFT JOIN project p ON p.id = s.project_id
			WHERE s.parent_id IS NULL
				AND s.id IS NOT ?3
				AND (
					lower(s.title) LIKE ?1
					OR s.id IN (
						SELECT m.session_id
						FROM session_message m
						WHERE m.type IN ('user', 'synthetic')
							AND lower(json_extract(m.data, '$.text')) LIKE ?1
					)
				)
			ORDER BY s.time_updated DESC
			LIMIT ?2
			`,
			)
			.all(lowerKeyword, limit, excludeSessionId ?? null)

		return rows.map((row) => {
			const projectPath = existsSync(row.directory) ? row.directory : (row.project_root ?? row.directory)
			return {
				sessionId: row.session_id,
				title: row.title ?? "",
				timeUpdated: row.time_updated,
				excerpt: row.excerpt ?? "",
				projectPath,
				projectName: projectDisplayName(projectPath),
			}
		})
	} finally {
		db.close()
	}
}

export function listProjects(dbPath: string): string[] {
	const db = new Database(dbPath, { readonly: true })
	try {
		return db
			.query<{ worktree: string }, []>(
				"SELECT worktree FROM project WHERE time_archived IS NULL ORDER BY time_active DESC",
			)
			.all()
			.map((row) => row.worktree)
	} finally {
		db.close()
	}
}

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

function timeAgo(unixMs: number): string {
	const diff = Math.floor((Date.now() - unixMs) / 1000)
	if (diff < 60) return "just now"
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
	if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
	return `${Math.floor(diff / 604800)}w ago`
}

function projectDisplayName(worktree: string): string {
	const segments = worktree.split(path.sep).filter(Boolean)
	if (segments.length >= 2) return segments.slice(-2).join("/")
	return segments.at(-1) ?? worktree
}

function truncate(text: string, maxLen: number): string {
	const clean = text.replace(/\s+/g, " ").trim()
	if (clean.length <= maxLen) return clean
	return `${clean.slice(0, maxLen)}…`
}

function buildQuestionOptions(
	matches: SessionMatch[],
): Array<{ label: string; description: string }> {
	return matches.map((m) => {
		const ago = timeAgo(m.timeUpdated)
		const excerpt = m.excerpt ? truncate(m.excerpt, 80) : ""
		return {
			label: m.title,
			description: `${m.projectName} · ${ago}${excerpt ? ` — ${excerpt}` : ""}`,
		}
	})
}

export function jumpQuery(text: string): string {
	return text.replace(/^\s*\/jump\b/, "").trim()
}

export function jumpPromptText(query: string, matches: SessionMatch[]): string {
	if (!query) {
		return "The user ran /jump without a search term. Ask them what to search for, then call project_search with their answer."
	}
	if (matches.length === 0) return `No conversations found matching "${query}".`
	return `Search results for "${query}" are ready (${matches.length} found). Use the question tool to ask the user which conversation to jump to. Use these options:\n${JSON.stringify(buildQuestionOptions(matches))}\n\nAfter they pick, ask resume or fork with a second question. Then call project_jump with pick=N and the chosen mode.`
}

const PROMPT_FILE_THRESHOLD = 500

async function resolvePrompt(prompt?: string): Promise<string | undefined> {
	if (!prompt || prompt.length <= PROMPT_FILE_THRESHOLD) return prompt
	const promptPath = path.join(
		os.tmpdir(),
		`opencode-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
	)
	await Bun.write(promptPath, prompt)
	return `Read the file at ${promptPath} and follow the instructions in it. Delete the file after reading.`
}

export function buildLaunchArgv(projectPath: string, sessionId?: string, prompt?: string): string[] {
	const argv = ["opencode"]
	if (sessionId) argv.push("--session", sessionId)
	if (prompt) argv.push("--prompt", prompt)
	argv.push(projectPath)
	return argv
}

// Calls back into this same service: it can't answer while its event loop is blocked, so a sync spawn would deadlock.
async function opencodeApi(apiPath: string, body: Record<string, unknown>): Promise<any> {
	const proc = Bun.spawn([process.execPath, "api", "post", apiPath, "--data", JSON.stringify(body)], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	if (exitCode !== 0) {
		throw new Error([stdout, stderr].map((text) => text.trim()).filter(Boolean).join(" ") || `opencode api exited with code ${exitCode}`)
	}
	return stdout.trim() ? JSON.parse(stdout).data : undefined
}

async function forkSession(sessionId: string): Promise<{ id: string; directory: string }> {
	const data = await opencodeApi(`/api/session/${sessionId}/fork`, {})
	return { id: data.id, directory: data.location.directory }
}

// =============================================================================
// PLUGIN
// =============================================================================

export const SKILLS_DIR = path.resolve(__dirname, "skills")

export function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
	if (!match) return { data: {}, body: raw }
	const data: Record<string, string> = {}
	// shortcut: single-line frontmatter values only, switch to a YAML parser if a skill needs multi-line values
	for (const line of match[1].split(/\r?\n/)) {
		const colon = line.indexOf(":")
		if (colon === -1) continue
		data[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
	}
	return { data, body: raw.slice(match[0].length) }
}

export interface SkillEntry {
	id: string
	name: string
	description?: string
	path: string
	content: string
}

export async function loadSkills(skillsDir: string): Promise<SkillEntry[]> {
	const entries = await fs.readdir(skillsDir, { withFileTypes: true })
	const skills: SkillEntry[] = []
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue
		const skillPath = path.join(skillsDir, entry.name, "SKILL.md")
		let raw: string
		try {
			raw = await fs.readFile(skillPath, "utf8")
		} catch {
			continue
		}
		const { data, body } = parseFrontmatter(raw)
		skills.push({
			id: entry.name,
			name: data.name || entry.name,
			...(data.description ? { description: data.description } : {}),
			path: skillPath,
			content: body,
		})
	}
	return skills
}

export default {
	id: "opencode-session-skills",
	async setup(ctx) {
		let skills: SkillEntry[] = []
		try {
			skills = await loadSkills(SKILLS_DIR)
		} catch (error) {
			console.error("opencode-session-skills: failed to load skills", error)
		}

		try {
			await ctx.skill.transform((editor) => {
				for (const skill of skills) {
					try {
						editor.add(skill as Parameters<typeof editor.add>[0])
					} catch (error) {
						console.error(`opencode-session-skills: failed to add skill ${skill.id}`, error)
					}
				}
			})
		} catch (error) {
			console.error("opencode-session-skills: failed to register skills", error)
		}

		let lastSearchResults: SessionMatch[] = []

		try {
			await ctx.tool.transform((editor) => {
				editor.add({
					name: "project_search",
					description:
						"Search conversations across ALL OpenCode projects by keyword, matching session titles and user messages. Returns matching sessions with excerpts. Use this when the user types /jump <query> or asks to find a conversation.",
					input: {
						type: "object",
						properties: {
							query: {
								type: "string",
								description: "Keyword to search for in session titles and message content",
							},
						},
						required: ["query"],
						additionalProperties: false,
					} as const,
					async execute(input, context) {
						const { query } = input as { query: string }
						const matches = searchSessions(OPENCODE_DB, query, context.sessionID)
						lastSearchResults = matches

						if (matches.length === 0) {
							return { content: `No conversations found matching "${query}".` }
						}

						const options = buildQuestionOptions(matches)
						return {
							content: `${JSON.stringify(options)}\n\nResults are cached. Call project_jump with pick=N and mode to open the user's choice.`,
						}
					},
				})

				editor.add({
					name: "project_list",
					description:
						"List all known OpenCode projects. Use this to discover which projects exist across your workspace.",
					input: { type: "object", properties: {}, additionalProperties: false } as const,
					async execute() {
						const projects = listProjects(OPENCODE_DB)
						if (projects.length === 0) return { content: "No projects found." }

						const lines = ["# Projects\n"]
						for (const worktree of projects) {
							lines.push(`- **${projectDisplayName(worktree)}** — \`${worktree}\``)
						}
						return { content: lines.join("\n") }
					},
				})

				editor.add({
					name: "project_jump",
					description:
						"Open a new terminal with OpenCode at a specific project, optionally resuming or forking an existing session, and optionally starting in a specific agent (e.g. build or plan, the same Build/Plan mode shown in the TUI). The user should choose the mode (resume or fork) before calling this tool.",
					input: {
						type: "object",
						properties: {
							projectPath: {
								type: "string",
								description: "Absolute path to the project directory",
							},
							sessionId: {
								type: "string",
								description: "Session ID to resume or fork. Omit to start a new session.",
							},
							mode: {
								type: "string",
								enum: ["resume", "fork"],
								description: "Whether to resume the session in-place or fork a copy. Defaults to resume.",
							},
							agent: {
								type: "string",
								description:
									"OpenCode agent name to start the session with, e.g. build or plan (or a custom agent from config), the same Build/Plan mode shown in the TUI, cycled with Tab. This is an agent name, not a model ID. Omit to use the project's default_agent.",
							},
							pick: {
								type: "number",
								description:
									"Pick number from the last search results (1-based). Resolves projectPath and sessionId from cache.",
							},
							prompt: {
								type: "string",
								description: "Prompt to send as the first message when opening the session.",
							},
						},
						additionalProperties: false,
					} as const,
					async execute(input) {
						const args = input as {
							projectPath?: string
							sessionId?: string
							mode?: "resume" | "fork"
							agent?: string
							pick?: number
							prompt?: string
						}
						let { projectPath, sessionId } = args
						const { mode, agent, prompt } = args

						if (args.pick != null) {
							const index = args.pick - 1
							if (index < 0 || index >= lastSearchResults.length) {
								return {
									content: `Invalid pick: ${args.pick}. Last search had ${lastSearchResults.length} results.`,
								}
							}
							const match = lastSearchResults[index]
							projectPath = match.projectPath
							sessionId = match.sessionId
						}

						if (!projectPath) {
							return { content: "Missing projectPath. Provide a path or a pick number." }
						}

						const forking = mode === "fork" && !!sessionId
						if (forking && sessionId) {
							try {
								const forked = await forkSession(sessionId)
								sessionId = forked.id
								projectPath = forked.directory
							} catch (error) {
								return {
									content: `Failed to fork session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
								}
							}
						}

						const existing = !!sessionId
						if (agent) {
							try {
								if (sessionId) {
									await ctx.session.switchAgent({ sessionID: sessionId, agent })
								} else {
									const created = await ctx.session.create({ agent, location: { directory: projectPath } })
									sessionId = created.id
								}
							} catch (error) {
								return {
									content: `Failed to set agent ${agent}: ${error instanceof Error ? error.message : String(error)}`,
								}
							}
						}

						const resolvedPrompt = await resolvePrompt(prompt)
						const launchArgv = buildLaunchArgv(projectPath, sessionId, resolvedPrompt)
						const windowName = path.basename(projectPath)
						const result = await openTerminal(projectPath, launchArgv, windowName)
						const destination = process.env.HERDR_ENV === "1" ? "Herdr workspace" : "terminal"

						if (!result.success) {
							return { content: `Failed to open ${destination}: ${result.error ?? "unknown error"}` }
						}

						const modeLabel = forking ? "forking" : existing ? "resuming" : "new session"
						return { content: `Opened ${windowName} in a new ${destination} (${modeLabel}).` }
					},
				})

				editor.add({
					name: "session_push",
					description:
						"Send a message to another OpenCode session through the shared OpenCode service, so a TUI showing that session updates live. An idle session starts a turn in the background right away. A busy session handles the message after its current turn. With noReply=true no turn starts: the message stays pending and joins the conversation on the session's next turn.",
					input: {
						type: "object",
						properties: {
							sessionId: {
								type: "string",
								description: "Target session ID (use project_search to find it)",
							},
							message: {
								type: "string",
								description: "Message to send to the session",
							},
							noReply: {
								type: "boolean",
								description:
									"If true, don't start a turn. The message joins the conversation on the session's next turn.",
							},
						},
						required: ["sessionId", "message"],
						additionalProperties: false,
					} as const,
					async execute(input) {
						const { sessionId, message, noReply } = input as {
							sessionId: string
							message: string
							noReply?: boolean
						}
						try {
							await ctx.session.prompt({
								sessionID: sessionId,
								text: message,
								delivery: "queue",
								resume: !noReply,
							})
						} catch (error) {
							// The service's errors have an empty message and only a _tag, which the host shows as a bare "Tool.Error".
							const reason = (error as Error).message || (error as { _tag?: string })._tag || String(error)
							throw new Error(`Failed to push to session ${sessionId}: ${reason}`)
						}
						return {
							content: noReply
								? `Message queued for session ${sessionId} without starting a turn. It joins the conversation on the session's next turn.`
								: `Message sent to session ${sessionId}. It starts a turn now, or after the current one if the session is busy.`,
						}
					},
				})
			})
		} catch (error) {
			console.error("opencode-session-skills: failed to register tools", error)
		}

		try {
			await ctx.command.transform((editor) => {
				editor.add({
					name: "jump",
					description: "Search conversations across all projects and jump to one",
					async execute({ sessionID, prompt, delivery }) {
						const query = jumpQuery(prompt.text)
						let matches: SessionMatch[] = []
						if (query) {
							matches = searchSessions(OPENCODE_DB, query, sessionID)
							lastSearchResults = matches
						}
						await ctx.session.prompt({ ...prompt, sessionID, text: jumpPromptText(query, matches), delivery })
					},
				})
			})
		} catch (error) {
			console.error("opencode-session-skills: failed to register commands", error)
		}
	},
} satisfies Plugin.Plugin
