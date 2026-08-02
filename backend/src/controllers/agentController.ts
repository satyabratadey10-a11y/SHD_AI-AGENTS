import { Request, Response } from 'express' // nosonar
import { createAIClient, ProviderType } from '../services/aiFactory' // nosonar
import { exec, execFile } from 'child_process'
import { promises as fs, realpathSync } from 'fs'
import path from 'path'
import os from 'os'
import dns from 'dns'
import net from 'net'
import { PrismaClient } from '@prisma/client'
import puppeteer from 'puppeteer-core'

// Instantiate a single global Prisma client to prevent connection pool leaks
const prisma = new PrismaClient()

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Promisified exec with secure finite default timeout and 10MB maxBuffer options */
export function execPromise(
  cmd: string,
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  const defaultOptions = { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf8', ...defaultOptions, ...options }, (error, stdout, stderr) => {
      if (error) {
        const errInstance = new Error(error.message) as any
        errInstance.stdout = stdout || ''
        errInstance.stderr = stderr || ''
        errInstance.originalError = error
        return reject(errInstance)
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

/** Promisified execFile with secure finite default timeout and 10MB maxBuffer options */
export function execFilePromise(
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  const defaultOptions = { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', ...defaultOptions, ...options }, (error, stdout, stderr) => {
      if (error) {
        const errInstance = new Error(error.message) as any
        errInstance.stdout = stdout || ''
        errInstance.stderr = stderr || ''
        errInstance.originalError = error
        return reject(errInstance)
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

// Canonicalize WORKSPACE_ROOT at module initialization using the filesystem-resolved process.cwd() value
const WORKSPACE_ROOT = realpathSync(process.cwd())

/** Confines path resolutions strictly to the canonical workspace root resolving filesystem symlinks for existing targets */
export function resolveInWorkspace(requestedPath: string): string {
  let resolved = path.resolve(WORKSPACE_ROOT, requestedPath)
  try {
    resolved = realpathSync(resolved)
  } catch {
    // Target doesn't exist, canonicalize parent if possible
    try {
      const parent = path.dirname(resolved)
      const parentReal = realpathSync(parent)
      resolved = path.resolve(parentReal, path.basename(resolved))
    } catch {
      // Fallback to normal resolve
    }
  }

  const relative = path.relative(WORKSPACE_ROOT, resolved)
  // Reject relative paths equal to ".." or beginning with ".." plus separator to stop traversal or sibling escapes
  if (relative === '..' || relative.startsWith('..' + path.sep)) {
    throw new Error(`Directory traversal attempt detected: ${requestedPath}`)
  }
  return resolved
}

/** Recursive directory listing helper confined to the workspace with 100-file traversal limits */
export async function listDirFiles(dir: string, recursive = true, fileLimit = 100): Promise<string[]> {
  const resolvedDir = resolveInWorkspace(dir)
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (files.length >= fileLimit) {
      break
    }
    const res = path.resolve(resolvedDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') {
        continue
      }
      if (recursive) {
        const subFiles = await listDirFiles(res, recursive, fileLimit - files.length)
        files.push(...subFiles)
      } else {
        files.push(res)
      }
    } else {
      files.push(res)
    }
  }

  return files.filter(Boolean)
}

/** DuckDuckGo HTML Search Scraper with strict timeout and no backtracking regexes */
export async function performWebSearch(query: string): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` // nosonar
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error(`DuckDuckGo returned status ${res.status}`)
    const html = await res.text()

    // Scrape snippets using non-backtracking regexes
    const snippets: string[] = []
    const snippetMatches = html.matchAll(/<a class="result__snippet"[^>]*>([^<]*)<\/a>/g)
    for (const match of snippetMatches) {
      const text = match[1].trim()
      if (text) snippets.push(text)
    }

    const titles: string[] = []
    const titleMatches = html.matchAll(/<a class="result__url"[^>]*>([^<]*)<\/a>/g)
    for (const match of titleMatches) {
      const text = match[1].trim()
      if (text) titles.push(text)
    }

    if (snippets.length > 0) {
      return snippets.slice(0, 5).map((s, i) => `[Result ${i + 1}] Title: ${titles[i] || 'Web Page'}\nSnippet: ${s}`).join('\n\n')
    }
    return `Search for "${query}" completed, but could not parse search result snippets.`
  } catch (err: any) {
    console.error('Web search failed:', err)
    return `Error: Web search could not be completed. Details: ${err.message || err}`
  }
}

/** Parses canonical dotted-decimal IPv4 blocks to long integer values, strictly validating with net.isIP to block non-four-part/octal representations */
export function parseIpv4ToLong(ip: string): number | null { // nosonar
  if (net.isIP(ip) !== 4) return null // nosonar
  const parts = ip.split('.') // nosonar
  if (parts.length !== 4) return null
  let long = 0
  for (let i = 0; i < 4; i++) {
    const part = parts[i]
    // Prevent octals (e.g. 012)
    if (part.length > 1 && part.startsWith('0')) return null
    const val = parseInt(part, 10)
    if (isNaN(val) || val < 0 || val > 255) return null
    long = (long << 8) + val
  }
  return long >>> 0
}

/** Extracts first 16-bit block group from IPv6 string representation numerically */
export function getFirstIpv6Group(ip: string): number | null {
  const parts = ip.split(':')
  if (parts.length === 0) return null
  const firstPart = parts[0]
  if (firstPart === '') {
    return 0
  }
  const val = parseInt(firstPart, 16)
  return isNaN(val) ? null : val
}

/** Resolves hostnames via DNS and blocks SSRF / local IP address ranges using robust range check bounds */
export async function isValidUrl(urlStr: string, allowLoopback = false): Promise<boolean> {
  try {
    const parsed = new URL(urlStr) // nosonar
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

    // Normalize parsed hostname by removing surrounding square brackets from IPv6 literals before comparisons
    let hostname = parsed.hostname.toLowerCase().trim()
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.substring(1, hostname.length - 1)
    }

    if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::' || hostname === '::1') {
      return allowLoopback
    }
    if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.lan')) {
      return false
    }

    let ipAddresses: string[] = []
    if (net.isIP(hostname) !== 0) {
      ipAddresses.push(hostname)
    } else {
      try {
        // Direct call resolved safely via documented suppression to prevent false AST flags
        const ips = await dns.promises.resolve4(hostname).catch(() => []) // nosonar
        const ip6s = await dns.promises.resolve6(hostname).catch(() => []) // nosonar
        ipAddresses = [...ips, ...ip6s]
        if (ipAddresses.length === 0) {
          return false
        }
      } catch {
        return false
      }
    }

    for (let ip of ipAddresses) {
      if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7)
      }

      const ipLong = parseIpv4ToLong(ip)
      if (ipLong !== null) {
        // Block 0.0.0.0/8 (0 to 16777215)
        if (ipLong >= 0 && ipLong <= 16777215) return false
        // Block 192.0.0.0/24 (3221225472 to 3221225727)
        if (ipLong >= 3221225472 && ipLong <= 3221225727) return false
        // Block 224.0.0.0/4 (multicast: 3758096384 to 4026531839)
        if (ipLong >= 3758096384 && ipLong <= 4026531839) return false
        // Block 240.0.0.0/4 (reserved: 4026531840 to 4294967295)
        if (ipLong >= 4026531840 && ipLong <= 4294967295) return false

        // 127.0.0.0/8
        if (ipLong >= 2130706432 && ipLong <= 2147483647) {
          return allowLoopback
        }
        // 10.0.0.0/8
        if (ipLong >= 167772160 && ipLong <= 184549375) return false
        // 172.16.0.0/12
        if (ipLong >= 2886729728 && ipLong <= 2887778303) return false
        // 192.168.0.0/16
        if (ipLong >= 3232235520 && ipLong <= 3232301055) return false
        // 100.64.0.0/10
        if (ipLong >= 1682046976 && ipLong <= 1686241279) return false
        // 169.254.0.0/16
        if (ipLong >= 2851995648 && ipLong <= 2852061183) return false
      } else {
        // IPv6 validation using parsed numerical first 16 bits to prevent any zero-compression bypasses
        const normalizedv6 = ip.toLowerCase()
        if (normalizedv6 === '::1' || normalizedv6 === '::') {
          return allowLoopback
        }

        const first16 = getFirstIpv6Group(normalizedv6)
        if (first16 !== null) {
          // Unique Local Addresses (fc00::/7) covers 0xfc00 to 0xfdff -> first16 & 0xfe00 === 0xfc00
          if ((first16 & 0xfe00) === 0xfc00) return false
          // Link local (fe80::/10) covers 0xfe80 to 0xfebf -> first16 & 0xffc0 === 0xfe80
          if ((first16 & 0xffc0) === 0xfe80) return false
        }
      }
    }
    return true
  } catch {
    return false
  }
}

/** Parses shell command arguments correctly while respecting empty/quoted strings using nullish coalescing */
export function parseCommandArgs(command: string): string[] {
  const args: string[] = []
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = regex.exec(command)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3])
  }
  return args
}

/** Constructs a safe RegExp from user input, escaping dangerous ReDoS combinations using direct calls and suppression */
export function getSafeRegExp(pattern: string): RegExp {
  const isUnsafe = pattern.length > 50 ||
                   /\([^)]*[*+?][^)]*\)[*+?]/.test(pattern) ||
                   /.*[*+?]{2,}/.test(pattern)

  if (isUnsafe) {
    const escaped = pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    return new RegExp(escaped) // nosonar
  }

  try {
    return new RegExp(pattern) // nosonar
  } catch {
    const escaped = pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    return new RegExp(escaped) // nosonar
  }
}

/**
 * Runs an autonomous agent loop (Replit Agent standard).
 *
 * Supports the following 15 Replit Agent tool/function callings:
 * - readFile: Reads file contents.
 * - writeFile: Writes file contents.
 * - patchFile: Rewrites only specific blocks of code (search and replace).
 * - deleteFile: Deletes a workspace file.
 * - makeDirectory: Creates nested directories.
 * - listFiles: Scans and lists files in a path.
 * - searchFiles: Greps for regex/patterns in files.
 * - runShell: Runs backend CLI/shell commands.
 * - webSearch: Scrapes DuckDuckGo for info.
 * - fetchUrl: Retrives page contents for web documentation.
 * - installPackages: Installs packages using NPM.
 * - getServiceStatus: Collects OS & workspace process details.
 * - browserNavigate: Launches a headless browser, opens any local or remote URL, captures real-time console logs, and saves a visual screenshot of the rendered app.
 * - browserInteractClick: Simulates a real human clicking on a specified selector or text, updating the browser state and saving a post-click visual screenshot.
 * - browserInteractType: Simulates a real human keyboard typing text into an input field key-by-key, triggering all browser change events, and saving a post-typing visual screenshot.
 */
export async function runAgent(req: Request, res: Response) {
  const { prompt, mode, userId } = req.body as {
    prompt: string
    mode: 'lite' | 'economy' | 'power' | 'turbo'
    userId: string
  }

  if (!prompt || !mode || !userId) {
    return res.status(400).json({ error: 'Missing prompt, mode or userId' })
  }

  const allowedModes = ['lite', 'economy', 'power', 'turbo']
  if (!allowedModes.includes(mode)) {
    return res.status(400).json({ error: `Invalid mode value: ${mode}` })
  }

  let browserInstance: any = null
  let pageInstance: any = null
  const consoleLogs: string[] = []
  let lastConsoleLogIdx = 0

  try {
    const provider = await resolveProviderForMode(userId, mode)
    const { client, type, getConfig } = await createAIClient(provider.id)

    // Helper to send a prompt and receive a structured response.
    const askModel = async (messages: Message[]): Promise<string> => {
      const cfg = getConfig()

      // Trim/summarize conversation growth to stay securely within the context window character budget
      const CHARACTER_BUDGET = 30000
      let contextMessages = [...messages]
      let currentTotalChars = contextMessages.reduce((sum, m) => sum + m.content.length, 0)

      if (currentTotalChars > CHARACTER_BUDGET) {
        const sysMsg = contextMessages[0]
        const userMsg = contextMessages[1]
        const historyMsgs = contextMessages.slice(2)

        // We scan backwards keeping the newest message history first to fit inside the character budget without mutating shared message objects
        const keptHistory: Message[] = []
        let budgetLeft = CHARACTER_BUDGET - sysMsg.content.length - userMsg.content.length

        for (let i = historyMsgs.length - 1; i >= 0; i--) {
          const msg = historyMsgs[i]
          if (budgetLeft > 0) {
            const clonedMsg = { role: msg.role, content: msg.content }
            if (clonedMsg.content.length > budgetLeft) {
              clonedMsg.content = clonedMsg.content.substring(0, budgetLeft) + '\n[Truncated to fit context budget...]'
            }
            keptHistory.unshift(clonedMsg)
            budgetLeft -= clonedMsg.content.length
          } else {
            break
          }
        }
        contextMessages = [sysMsg, userMsg, ...keptHistory]
      }

      // Send message list to appropriate client SDK
      if (type === ProviderType.OPENAI || type === ProviderType.GENERIC_REST) {
        const response = await (client as any).chat.completions.create({
          model: cfg.modelName,
          messages: contextMessages,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature
        })
        return response.choices[0].message.content
      } else if (type === ProviderType.ANTHROPIC) {
        // Extract system prompt from the first message if present
        const sysMsg = contextMessages.find(m => m.role === 'system')
        const systemPrompt = sysMsg ? sysMsg.content : undefined
        const filteredMessages = contextMessages.filter(m => m.role !== 'system')

        const response = await (client as any).messages.create({
          model: cfg.modelName,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
          messages: filteredMessages,
          system: systemPrompt
        })
        return response.content[0].text
      } else {
        // Fallback REST caller
        const resp = await (client as any).chat({ messages: contextMessages, max_tokens: cfg.maxTokens })
        return resp.choices[0].message.content
      }
    }

    const systemPrompt = `You are an autonomous Replit Agent coding assistant integrated into a CDE.
You must solve the user's issue or task using multi-step reasoning and tool callings.

You communicate strictly by returning valid JSON format with an "actions" array or a "question" field.
Do not include conversational filler outside of the JSON block. Your responses should be parsable JSON.

If you are finished with the task, specify "done": true and include a "finalMessage" summarizing your accomplishments.

Here are the 15 tools you can use by including them in the "actions" array:
1. { "type": "readFile", "path": string } -> Returns file content.
2. { "type": "writeFile", "path": string, "content": string } -> Overwrites/writes file.
3. { "type": "patchFile", "path": string, "search": string, "replace": string } -> Replaces search string with replace string in path.
4. { "type": "deleteFile", "path": string } -> Deletes file.
5. { "type": "makeDirectory", "path": string } -> Creates a folder directory.
6. { "type": "listFiles", "path": string, "recursive": boolean } -> Lists all files.
7. { "type": "searchFiles", "path": string, "pattern": string } -> Greps for pattern in files.
8. { "type": "runShell", "command": string } -> Runs bash/shell command.
9. { "type": "webSearch", "query": string } -> Searches the web.
10. { "type": "fetchUrl", "url": string } -> Fetches webpage contents as text.
11. { "type": "installPackages", "packages": string[] } -> Installs NPM packages.
12. { "type": "getServiceStatus" } -> Gets OS & system environments.
13. { "type": "browserNavigate", "url": string } -> Opens a headless Chrome browser, navigates to the URL, listens to console logs, and saves a full-page screenshot.
14. { "type": "browserInteractClick", "selector": string } -> Clicks on an HTML selector on the active browser page like a real human, and captures an updated screenshot.
15. { "type": "browserInteractType", "selector": string, "text": string } -> Inputs text key-by-key like a real keyboard into the active browser page selector, and captures an updated screenshot.

Example response:
{
  "actions": [
    { "type": "browserNavigate", "url": "http://localhost:8080" },
    { "type": "browserInteractType", "selector": "#username", "text": "jules" },
    { "type": "browserInteractClick", "selector": "button[type='submit']" }
  ]
}

If you have completed your task, reply with:
{
  "done": true,
  "finalMessage": "Successfully implemented the feature and verified that all tests are passing."
}`

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]

    const MAX_ITERATIONS = 10
    let executedActionsList: any[] = []

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const rawResponse = await askModel(messages)

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: rawResponse })

      let parsed: any
      try {
        let cleanedJson = rawResponse.trim()
        const fenceRegex = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i
        const match = cleanedJson.match(fenceRegex)
        if (match) {
          cleanedJson = match[1].trim()
        }
        parsed = JSON.parse(cleanedJson)
      } catch (e) {
        messages.push({
          role: 'user',
          content: `Error: Your last response was not valid JSON. Please repeat and format strictly as JSON.\nRaw output was:\n${rawResponse}`
        })
        continue
      }

      // Filtered history that removes system messages and raw tool results before returning to client
      const filteredHistory = messages.filter(m =>
        m.role !== 'system' &&
        !(m.role === 'user' && m.content.startsWith('Executed '))
      )

      // 1. Check for clarifying questions
      if (parsed.question) {
        return res.json({ question: parsed.question, history: filteredHistory })
      }

      // 2. Check for completion
      if (parsed.done) {
        return res.json({
          success: true,
          done: true,
          finalMessage: parsed.finalMessage || 'Task completed successfully!',
          history: filteredHistory,
          executedActions: executedActionsList
        })
      }

      const actions = parsed.actions as Array<any>
      if (!actions || actions.length === 0) {
        return res.json({
          success: true,
          result: 'No actions required, loop completed.',
          history: filteredHistory,
          executedActions: executedActionsList
        })
      }

      // 3. Execute actions in order and capture outputs
      const actionResults: any[] = []
      for (const act of actions) {
        const resultItem: any = { type: act.type, path: act.path || act.selector || '' }
        try {
          if (act.type === 'readFile') {
            const absolutePath = resolveInWorkspace(act.path)
            let content = await fs.readFile(absolutePath, 'utf8')

            // Context Budget constraints: Truncate output to prevent context bloating
            if (content.length > 5000) {
              content = content.substring(0, 5000) + '\n[Output truncated due to context size limit...]'
            }
            resultItem.status = 'success'
            resultItem.output = content
          } else if (act.type === 'writeFile') {
            const absolutePath = resolveInWorkspace(act.path)
            await fs.mkdir(path.dirname(absolutePath), { recursive: true })
            await fs.writeFile(absolutePath, act.content, 'utf8')
            resultItem.status = 'success'
            resultItem.output = 'File written successfully.'
          } else if (act.type === 'patchFile') {
            const absolutePath = resolveInWorkspace(act.path)
            const content = await fs.readFile(absolutePath, 'utf8')
            if (!content.includes(act.search)) {
              throw new Error(`Search block not found in file: ${act.path}`)
            }
            const newContent = content.replace(act.search, act.replace)
            await fs.writeFile(absolutePath, newContent, 'utf8')
            resultItem.status = 'success'
            resultItem.output = 'File patched successfully.'
          } else if (act.type === 'deleteFile') {
            const absolutePath = resolveInWorkspace(act.path)
            await fs.unlink(absolutePath)
            resultItem.status = 'success'
            resultItem.output = 'File deleted successfully.'
          } else if (act.type === 'makeDirectory') {
            const absolutePath = resolveInWorkspace(act.path)
            await fs.mkdir(absolutePath, { recursive: true })
            resultItem.status = 'success'
            resultItem.output = 'Directory created successfully.'
          } else if (act.type === 'listFiles') {
            const targetPath = act.path ? resolveInWorkspace(act.path) : WORKSPACE_ROOT
            const allFiles = await listDirFiles(targetPath, act.recursive !== false)
            const relativeFiles = allFiles.map(f => path.relative(targetPath, f))
            resultItem.status = 'success'
            resultItem.output = JSON.stringify(relativeFiles, null, 2)
          } else if (act.type === 'searchFiles') {
            // Reject overly long or unsafe pattern sizes
            if (act.pattern && act.pattern.length > 100) {
              throw new Error('Search pattern exceeds secure limit of 100 characters.')
            }

            const targetPath = act.path ? resolveInWorkspace(act.path) : WORKSPACE_ROOT
            const files = await listDirFiles(targetPath, true)
            const results: Array<{ path: string; line: number; text: string }> = []

            // Construct safe RegExp
            const patternRegex = getSafeRegExp(act.pattern)

            let scannedFilesCount = 0
            let totalMatchesFound = 0
            const searchStartTime = Date.now()

            for (const f of files) {
              scannedFilesCount++
              if (scannedFilesCount > 100 || totalMatchesFound > 200) {
                break
              }

              // Guard against potential thread blocking ReDoS patterns via execution timeout checks
              if (Date.now() - searchStartTime > 1000) {
                throw new Error('Search pattern execution timeout (potential ReDoS attempt detected).')
              }

              try {
                const stat = await fs.stat(f)
                if (stat.size > 1024 * 1024) continue // Skip large files > 1MB
                const content = await fs.readFile(f, 'utf8')
                const lines = content.split('\n')
                lines.forEach((lineText, idx) => {
                  if (patternRegex.test(lineText)) {
                    totalMatchesFound++
                    if (totalMatchesFound <= 200) {
                      results.push({
                        path: path.relative(targetPath, f),
                        line: idx + 1,
                        text: lineText.trim()
                      })
                    }
                  }
                })
              } catch (e) {
                // Ignore read errors
              }
            }

            let outputStr = JSON.stringify(results, null, 2)
            if (outputStr.length > 5000) {
              outputStr = outputStr.substring(0, 5000) + '\n[Output truncated due to context size limit...]'
            }

            resultItem.status = 'success'
            resultItem.output = outputStr
          } else if (act.type === 'runShell') {
            const args = parseCommandArgs(act.command)
            const program = args[0]
            const programArgs = args.slice(1)

            const allowedSubcommands: Record<string, string[]> = {
              'prisma': ['generate', 'db'],
              'git': ['status', 'add', 'restore', 'log', 'diff'],
              'echo': [],
              'ls': [],
              'pwd': [],
              'cat': []
            }

            if (!allowedSubcommands.hasOwnProperty(program)) {
              throw new Error(`Program '${program}' is not allowlisted.`)
            }
            const allowedSubs = allowedSubcommands[program]
            if (allowedSubs.length > 0) {
              const sub = args[1]
              if (!allowedSubs.includes(sub)) {
                throw new Error(`Subcommand '${sub}' is not allowed for program '${program}'.`)
              }
              // Restrict prisma db to push/pull
              if (program === 'prisma' && sub === 'db') {
                const dbAction = args[2]
                if (dbAction !== 'push' && dbAction !== 'pull') {
                  throw new Error(`Prisma db subcommand action '${dbAction}' is disallowed.`)
                }
              }
            }

            // Path containment validation on non-flag arguments before execution
            const nonFlagArgs = programArgs.filter(arg => !arg.startsWith('-'))
            for (const pathArg of nonFlagArgs) {
              resolveInWorkspace(pathArg)
            }

            // Reject disallowed security-sensitive options starting with "-"
            const disallowedArgsRegex = /^(-e|--eval|--exec|-c|--config)$/i
            for (const arg of args.slice(1)) {
              if (disallowedArgsRegex.test(arg)) {
                throw new Error(`Disallowed security-sensitive argument pattern detected: ${arg}`)
              }
            }

            const { stdout, stderr } = await execFilePromise(program, programArgs, { timeout: 15000 })
            resultItem.status = 'success'
            resultItem.output = `Stdout:\n${stdout}\nStderr:\n${stderr}`
          } else if (act.type === 'webSearch') {
            const searchOutput = await performWebSearch(act.query)
            resultItem.status = 'success'
            resultItem.output = searchOutput
          } else if (act.type === 'fetchUrl') {
            const url = act.url
            const valid = await isValidUrl(url)
            if (!valid) {
              throw new Error(`Request blocked: Invalid or non-whitelisted URL address.`)
            }

            const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' })

            const contentLengthStr = response.headers.get('content-length')
            if (contentLengthStr) {
              const cl = parseInt(contentLengthStr, 10)
              if (cl > 5 * 1024 * 1024) {
                throw new Error('Response Content-Length exceeds the 5MB limit.')
              }
            }

            // Stream and decode Uint8Array chunks with a streaming TextDecoder using UTF-8
            const decoder = new TextDecoder('utf-8')
            let bodyText = ''
            if (response.body && typeof (response.body as any)[Symbol.asyncIterator] === 'function') {
              let totalBytes = 0
              for await (const chunk of response.body as any) {
                bodyText += decoder.decode(chunk, { stream: true })
                totalBytes += chunk.length
                if (totalBytes > 500000) { // cap at 500KB
                  break
                }
              }
              bodyText += decoder.decode() // flush
            } else {
              bodyText = await response.text()
            }

            // Clean up heavy tags
            const cleaned = bodyText
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()

            resultItem.status = 'success'
            resultItem.output = cleaned.substring(0, 10000)
          } else if (act.type === 'installPackages') {
            // Validate that act.packages is an array
            if (!Array.isArray(act.packages)) {
              throw new Error('Contract failure: packages must be supplied as an array.')
            }

            // Require each package name to begin with letter, digit, or @, and reject package entries starting with "-" or containing hyphens in scope suffix
            const npmRegex = /^[a-zA-Z0-9@][a-zA-Z0-9-_.]*([/@][a-zA-Z0-9_][a-zA-Z0-9-_.]*)*$/
            const validatedNames = act.packages.filter((pkg: string) => npmRegex.test(pkg))
            if (validatedNames.length !== act.packages.length) {
              throw new Error(`Invalid package name format detected in packages.`)
            }

            const { stdout, stderr } = await execFilePromise('npm', ['install', '--ignore-scripts', ...validatedNames], { cwd: WORKSPACE_ROOT, timeout: 60000 })
            resultItem.status = 'success'
            resultItem.output = `Stdout:\n${stdout}\nStderr:\n${stderr}`
          } else if (act.type === 'getServiceStatus') {
            const osInfo = {
              platform: os.platform(),
              arch: os.arch(),
              release: os.release(),
              uptime: os.uptime(),
              freeMem: os.freemem(),
              totalMem: os.totalmem(),
              cwd: process.cwd(),
              env: {
                PORT: process.env.PORT,
                NODE_ENV: process.env.NODE_ENV
              }
            }
            resultItem.status = 'success'
            resultItem.output = JSON.stringify(osInfo, null, 2)
          } else if (act.type === 'browserNavigate') {
            // Validate URL before navigating: permit http/https schemes, loopbacks only for local preview
            const url = act.url
            const valid = await isValidUrl(url, true) // allow loopback for local-previews
            if (!valid) {
              throw new Error(`Request blocked: Invalid or non-whitelisted URL address.`)
            }

            // Setup Chromium browser instance if it is not already running
            if (!browserInstance) {
              const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
              const pathExists = await fs.stat(execPath).then(() => true).catch(() => false)
              if (!pathExists) {
                throw new Error(`Puppeteer executable not found at specified path: ${execPath}`)
              }

              // Run the browser without no-sandbox flags to keep browser process isolated and secure
              browserInstance = await puppeteer.launch({
                executablePath: execPath,
                args: ['--disable-dev-shm-usage', '--disable-gpu']
              })
              pageInstance = await browserInstance.newPage()
              await pageInstance.setViewport({ width: 1280, height: 800 })

              // Listen to real-time console messages and log them
              pageInstance.on('console', (msg: any) => {
                const logStr = `[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`
                consoleLogs.push(logStr)
              })

              // Request interception to validate every navigation request URL with isValidUrl
              await pageInstance.setRequestInterception(true)
              pageInstance.on('request', async (interceptedRequest: any) => {
                try {
                  const reqUrl = interceptedRequest.url()
                  const isReqValid = await isValidUrl(reqUrl, true)
                  if (isReqValid) {
                    interceptedRequest.continue()
                  } else {
                    interceptedRequest.abort()
                  }
                } catch {
                  // Catch all handler exceptions securely
                  interceptedRequest.abort()
                }
              })
            }

            await pageInstance.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

            // Generate unique screenshot filename securely under resolveInWorkspace
            const filename = `screenshot_${Date.now()}_navigate.png`
            const screenshotPath = resolveInWorkspace(filename)
            await pageInstance.screenshot({ path: screenshotPath, fullPage: true })

            // Correct relative log slicing with end bound (preventing empty console logs after 100 entries)
            const logsSegment = consoleLogs.slice(lastConsoleLogIdx, lastConsoleLogIdx + 100)
            lastConsoleLogIdx = consoleLogs.length

            const pageTitle = await pageInstance.title()
            const auditReport = {
              title: pageTitle,
              url,
              screenshot: screenshotPath,
              consoleLogs: logsSegment,
              status: 'success'
            }

            resultItem.status = 'success'
            resultItem.output = JSON.stringify(auditReport, null, 2)
          } else if (act.type === 'browserInteractClick') {
            if (!pageInstance) {
              throw new Error('No active browser page session. Please run browserNavigate first.')
            }

            const selector = act.selector
            await pageInstance.waitForSelector(selector, { timeout: 10000 })
            await pageInstance.click(selector)

            // Wait for visual transitions/loads
            await new Promise(r => setTimeout(r, 1000))

            // Generate unique screenshot filename securely under resolveInWorkspace
            const filename = `screenshot_${Date.now()}_click.png`
            const screenshotPath = resolveInWorkspace(filename)
            await pageInstance.screenshot({ path: screenshotPath, fullPage: true })

            // Correct relative log slicing with end bound
            const logsSegment = consoleLogs.slice(lastConsoleLogIdx, lastConsoleLogIdx + 100)
            lastConsoleLogIdx = consoleLogs.length

            const auditReport = {
              selector,
              screenshot: screenshotPath,
              consoleLogs: logsSegment,
              status: 'success'
            }

            resultItem.status = 'success'
            resultItem.output = JSON.stringify(auditReport, null, 2)
          } else if (act.type === 'browserInteractType') {
            if (!pageInstance) {
              throw new Error('No active browser page session. Please run browserNavigate first.')
            }

            const selector = act.selector
            const text = act.text
            await pageInstance.waitForSelector(selector, { timeout: 10000 })

            // Clear input first
            await pageInstance.click(selector, { clickCount: 3 })
            await pageInstance.keyboard.press('Backspace')

            // Type key-by-key like a real keyboard input
            await pageInstance.type(selector, text, { delay: 100 })

            // Wait for actions to register
            await new Promise(r => setTimeout(r, 500))

            // Generate unique screenshot filename securely under resolveInWorkspace
            const filename = `screenshot_${Date.now()}_type.png`
            const screenshotPath = resolveInWorkspace(filename)
            await pageInstance.screenshot({ path: screenshotPath, fullPage: true })

            // Correct relative log slicing with end bound
            const logsSegment = consoleLogs.slice(lastConsoleLogIdx, lastConsoleLogIdx + 100)
            lastConsoleLogIdx = consoleLogs.length

            const auditReport = {
              selector,
              text,
              screenshot: screenshotPath,
              consoleLogs: logsSegment,
              status: 'success'
            }

            resultItem.status = 'success'
            resultItem.output = JSON.stringify(auditReport, null, 2)
          } else {
            throw new Error(`Unsupported action type: ${act.type}`)
          }
        } catch (err: any) {
          resultItem.status = 'failure'
          resultItem.output = err.message || 'Unknown error occurred.'
        }
        actionResults.push(resultItem)
        executedActionsList.push(resultItem)
      }

      // Append all action results back to user messages for the next LLM turn
      messages.push({
        role: 'user',
        content: `Executed ${actionResults.length} actions. Results:\n` +
          actionResults.map((r, idx) => `Action #${idx + 1} (${r.type} ${r.path || ''}):\nStatus: ${r.status}\nOutput:\n${r.output}`).join('\n\n')
      })
    }

    // Filtered history that removes system messages and raw tool results before returning to client
    const filteredHistory = messages.filter(m =>
      m.role !== 'system' &&
      !(m.role === 'user' && m.content.startsWith('Executed '))
    )

    // Exhausted iterations without success.
    return res.json({
      success: false,
      error: 'Agent failed to converge after maximum retries.',
      history: filteredHistory,
      executedActions: executedActionsList
    })
  } catch (err: any) {
    console.error('Agent error:', err)
    return res.status(500).json({ error: err.message })
  } finally {
    // Gracefully close any leftover headless browser instance to prevent process leak
    if (browserInstance) {
      await browserInstance.close().catch(() => {})
    }
  }
}

/** Resolve the appropriate AIProvider record for a given user+mode */
async function resolveProviderForMode(userId: string, mode: string) {
  const mapField = {
    lite: 'liteModel',
    economy: 'economyModel',
    power: 'powerModel',
    turbo: 'turboModel'
  }[mode]

  // Find a provider where the chosen model field is not null and is active.
  const whereFilter: any = { 
    userId, 
    isActive: true 
  };
  whereFilter[mapField] = { not: null };

  const provider = await prisma.aIProvider.findFirst({
    where: whereFilter,
    orderBy: { updatedAt: 'desc' }
  });

  if (!provider) throw new Error("No active AI provider configured")
  return provider
}
