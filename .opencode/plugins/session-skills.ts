/**
 * Session Skills Plugin for OpenCode
 *
 * Provides tools for searching, listing, and jumping between
 * OpenCode sessions across all projects, along with session-related skills.
 *
 * Tools: project_search, project_list, project_sessions, project_jump, session_push
 * Skills: session-jump, session-push, session-db, session-recover
 */

import { Database } from "bun:sqlite"
import * as fs from "node:fs/promises"
import { watch } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { type Plugin, tool } from "@opencode-ai/plugin"
import type { OpencodeClient, Project } from "@opencode-ai/sdk"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OPENCODE_DB = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")

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
// TERMINAL — UNIFIED ENTRY POINT
// =============================================================================

async function openTerminal(
	cwd: string,
	argv?: string[],
	windowName?: string,
): Promise<TerminalResult> {
	const normalizedArgv = argv ?? []

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

interface SessionMatch {
	sessionId: string
	projectId: string
	title: string
	timeUpdated: number
	excerpt: string
	projectPath: string
	projectName: string
}

function searchSessions(
	keyword: string,
	excludeSessionId?: string,
	limit = 10,
): SessionMatch[] {
	const db = new Database(OPENCODE_DB, { readonly: true })

	try {
		const lowerKeyword = `%${keyword.toLowerCase()}%`

		const rows = db
			.query<
				{
					session_id: string
					project_id: string
					title: string
					time_updated: number
					excerpt: string | null
					worktree: string
				},
				[string, number]
			>(
				`
			SELECT
				s.id as session_id,
				s.project_id,
				s.title,
				s.time_updated,
				pr.worktree,
				(
					SELECT substr(json_extract(p.data, '$.text'), 1, 200)
					FROM part p
					JOIN message m ON p.message_id = m.id
					WHERE m.session_id = s.id
						AND json_extract(p.data, '$.type') = 'text'
						AND json_extract(p.data, '$.text') IS NOT NULL
						AND length(json_extract(p.data, '$.text')) > 20
						AND lower(json_extract(p.data, '$.text')) LIKE ?1
						AND json_extract(m.data, '$.role') = 'user'
						AND json_extract(p.data, '$.text') NOT LIKE 'Use the %tool%'
						AND json_extract(p.data, '$.text') NOT LIKE 'The user searched%'
						AND json_extract(p.data, '$.text') NOT LIKE 'Search results for%'
					ORDER BY p.time_created ASC
					LIMIT 1
				) as excerpt
			FROM session s
			JOIN project pr ON s.project_id = pr.id
			WHERE s.parent_id IS NULL
				AND s.title NOT LIKE '%(@% subagent)%'
				AND (
					lower(s.title) LIKE ?1
					OR s.id IN (
						SELECT DISTINCT m.session_id
						FROM part p
						JOIN message m ON p.message_id = m.id
						WHERE json_extract(p.data, '$.type') = 'text'
							AND lower(json_extract(p.data, '$.text')) LIKE ?1
					)
				)
			ORDER BY s.time_updated DESC
			LIMIT ?2
			`,
			)
			.all(lowerKeyword, limit)

		return rows
			.filter((row) => row.session_id !== excludeSessionId)
			.map((row) => ({
				sessionId: row.session_id,
				projectId: row.project_id,
				title: row.title,
				timeUpdated: row.time_updated,
				excerpt: row.excerpt ?? "",
				projectPath: row.worktree,
				projectName: projectDisplayName(row.worktree),
			}))
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

function buildLaunchArgv(
	projectPath: string,
	sessionId?: string,
	mode?: "resume" | "fork",
	prompt?: string,
): string[] {
	const argv = ["opencode"]
	if (sessionId) {
		argv.push("--session", sessionId)
		if (mode === "fork") {
			argv.push("--fork")
		}
	}
	if (prompt) {
		argv.push("--prompt", prompt)
	}
	argv.push(projectPath)
	return argv
}

// =============================================================================
// PUSH QUEUE
// =============================================================================

const PUSH_QUEUE_DIR = path.join(os.homedir(), ".local", "share", "opencode", "push-queue")

interface QueuedMessage {
	message: string
	noReply: boolean
}

async function processQueue(sessionId: string, client: OpencodeClient): Promise<void> {
	const queueDir = path.join(PUSH_QUEUE_DIR, sessionId)

	let files: string[]
	try {
		files = await fs.readdir(queueDir)
	} catch {
		return
	}

	for (const file of files.sort()) {
		if (!file.endsWith(".json")) continue
		const filePath = path.join(queueDir, file)

		let content: QueuedMessage
		try {
			const raw = await fs.readFile(filePath, "utf8")
			await fs.unlink(filePath) // consume before processing to avoid double-delivery
			content = JSON.parse(raw) as QueuedMessage
		} catch {
			continue
		}

		try {
			await client.session.promptAsync({
				path: { id: sessionId },
				body: {
					noReply: content.noReply,
					parts: [{ type: "text", text: content.message }],
				},
			})
		} catch {
			// message consumed but delivery failed — accepted tradeoff
		}
	}
}

function watchSession(sessionId: string, client: OpencodeClient): void {
	const queueDir = path.join(PUSH_QUEUE_DIR, sessionId)

	fs.mkdir(queueDir, { recursive: true })
		.then(() => {
			// Deliver any messages that arrived while this session was inactive
			processQueue(sessionId, client).catch(() => {})

			// Watch for new messages in real-time
			watch(queueDir, () => {
				processQueue(sessionId, client).catch(() => {})
			})
		})
		.catch(() => {})
}

// =============================================================================
// PLUGIN
// =============================================================================

export const SessionSkillsPlugin: Plugin = async ({ client, project }) => {
	let lastSearchResults: SessionMatch[] = []
	const skillsDir = path.resolve(__dirname, "../../skills")

	// Set up push queue watchers in the background — must not block plugin init
	void (async () => {
		try {
			const sessionsResult = await client.session.list()
			for (const session of sessionsResult.data ?? []) {
				if (session.projectID === project.id) {
					watchSession(session.id, client)
				}
			}
		} catch {
			// non-fatal — push queue won't work but everything else will
		}
	})()

	return {
		event: async ({ event }) => {
			// Watch new sessions as they're created in this project
			if (
				event.type === "session.created" &&
				event.properties.info.projectID === project.id
			) {
				watchSession(event.properties.info.id, client)
			}
		},

		config: async (config) => {
			config.skills = config.skills || {}
			config.skills.paths = config.skills.paths || []
			if (!config.skills.paths.includes(skillsDir)) {
				config.skills.paths.push(skillsDir)
			}
		},

		"command.execute.before": async (input, output) => {
			if (input.command !== "jump") return
			if (!input.arguments.trim()) return

			const query = input.arguments.trim()
			const matches = searchSessions(query, input.sessionID)
			lastSearchResults = matches

			if (matches.length === 0) {
				output.parts.length = 0
				output.parts.push({
					type: "text",
					text: `No conversations found matching "${query}".`,
				})
				return
			}

			const options = buildQuestionOptions(matches)
			output.parts.length = 0
			output.parts.push({
				type: "text",
				text: `Search results for "${query}" are ready (${matches.length} found). Use the question tool to ask the user which conversation to jump to. Use these options:\n${JSON.stringify(options)}\n\nAfter they pick, ask resume or fork with a second question. Then call project_jump with pick=N and the chosen mode.`,
			})
		},

		tool: {
			session_push: tool({
				description:
					"Push a message or context to any OpenCode session. Use noReply=true for silent context injection without triggering an AI response. Use noReply=false (default) to trigger the AI to respond. If the target session is active, the message is delivered in real-time via the session's own server (SSE fires, TUI updates live). If inactive, the message is queued and delivered when the session next opens. Use project_search to find the target sessionId first.",
				args: {
					sessionId: tool.schema
						.string()
						.describe("Target session ID. Use project_search to find it."),
					message: tool.schema.string().describe("Message text to push to the session."),
					noReply: tool.schema
						.boolean()
						.optional()
						.describe(
							"If true, injects context silently without triggering an AI response. Defaults to false.",
						),
				},
				async execute(args) {
					const queueDir = path.join(PUSH_QUEUE_DIR, args.sessionId)
					await fs.mkdir(queueDir, { recursive: true })

					const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.json`
					const content: QueuedMessage = {
						message: args.message,
						noReply: args.noReply ?? false,
					}
					await Bun.write(path.join(queueDir, filename), JSON.stringify(content))

					const mode = args.noReply ? "silent context injection" : "AI will respond"
					return `Message queued for session ${args.sessionId} (${mode}). Delivered in real-time if session is active, otherwise on next open.`
				},
			}),

			project_sessions: tool({
				description:
					"Open the native session picker showing sessions across all projects. Use when the user wants to browse and switch sessions visually.",
				args: {},
				async execute() {
					await client.tui.openSessions({})
					return "Session picker opened."
				},
			}),

			project_list: tool({
				description:
					"List all known OpenCode projects and their recent sessions. Use this to discover which projects and conversations exist across your workspace.",
				args: {},
				async execute() {
					const projectsResponse = await client.project.list()
					const projects = (projectsResponse.data ?? []) as Project[]

					if (projects.length === 0) return "No projects found."

					const lines: string[] = ["# Projects\n"]
					for (const project of projects) {
						const name = projectDisplayName(project.worktree)
						lines.push(`- **${name}** — \`${project.worktree}\``)
					}
					return lines.join("\n")
				},
			}),

			project_search: tool({
				description:
					"Search conversations across ALL OpenCode projects by keyword. Returns matching sessions with excerpts. Use this when the user types /jump <query> or asks to find a conversation.",
				args: {
					query: tool.schema
						.string()
						.describe("Keyword to search for in session titles and message content"),
				},
				async execute(args, context) {
					const matches = searchSessions(args.query, context.sessionID)
					lastSearchResults = matches

					if (matches.length === 0) {
						return `No conversations found matching "${args.query}".`
					}

					const options = buildQuestionOptions(matches)
					return `${JSON.stringify(options)}\n\nResults are cached. Call project_jump with pick=N and mode to open the user's choice.`
				},
			}),

			project_jump: tool({
				description:
					"Open a new terminal with OpenCode at a specific project, optionally resuming or forking an existing session. The user should choose the mode (resume or fork) before calling this tool.",
				args: {
					projectPath: tool.schema
						.string()
						.describe("Absolute path to the project directory"),
					sessionId: tool.schema
						.string()
						.optional()
						.describe("Session ID to resume or fork. Omit to start a new session."),
					mode: tool.schema
						.enum(["resume", "fork"])
						.optional()
						.describe(
							"Whether to resume the session in-place or fork a copy. Defaults to resume.",
						),
					pick: tool.schema
						.number()
						.optional()
						.describe(
							"Pick number from the last search results (1-based). Resolves projectPath and sessionId from cache.",
						),
					prompt: tool.schema
						.string()
						.optional()
						.describe(
							"Prompt to send as the first message when opening the session.",
						),
				},
				async execute(args) {
					let { projectPath, sessionId, mode, prompt } = args

					if (args.pick != null) {
						const index = args.pick - 1
						if (index < 0 || index >= lastSearchResults.length) {
							return `Invalid pick: ${args.pick}. Last search had ${lastSearchResults.length} results.`
						}
						const match = lastSearchResults[index]
						projectPath = match.projectPath
						sessionId = match.sessionId
					}

					if (!projectPath) {
						return "Missing projectPath. Provide a path or a pick number."
					}

					const launchArgv = buildLaunchArgv(projectPath, sessionId, mode ?? "resume", prompt)
					const windowName = path.basename(projectPath)
					const result = await openTerminal(projectPath, launchArgv, windowName)

					if (!result.success) {
						return `Failed to open terminal: ${result.error ?? "unknown error"}`
					}

					const modeLabel = sessionId
						? mode === "fork"
							? "forking"
							: "resuming"
						: "new session"

					return `Opened ${windowName} in a new terminal (${modeLabel}).`
				},
			}),
		},
	}
}

export default SessionSkillsPlugin
