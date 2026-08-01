import { Request, Response } from 'express'
import { createAIClient, ProviderType } from '../services/aiFactory'
import { exec, execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import dns from 'dns'
import { PrismaClient } from '@prisma/client'
import puppeteer from 'puppeteer-core'

// Instantiate a single global Prisma client to prevent connection pool leaks
const prisma = new PrismaClient()

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Promisified exec with advanced timeout, buffer, and cwd configuration */
export function execPromise(
  cmd: string,
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf8', ...options }, (error, stdout, stderr) => {
      if (error) {
        return reject({
          message: error.message,
          stdout: stdout || '',
          stderr: stderr || '',
          error
        })
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

/** Promisified execFile */
export function execFilePromise(
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', ...options }, (error, stdout, stderr) => {
      if (error) {
        return reject({
          message: error.message,
          stdout: stdout || '',
          stderr: stderr || '',
          error
        })
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

const WORKSPACE_ROOT = process.cwd()

/** Confines path resolutions strictly to the workspace root to prevent directory traversal */
export function resolveInWorkspace(requestedPath: string): string {
  // Normalize and fully resolve the path first (expands '..' and absolute directories)
  const resolved = path.resolve(WORKSPACE_ROOT, requestedPath)
  // Ensure the resolved path remains inside the workspace root
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Directory traversal attempt detected: ${requestedPath}`)
  }
  return resolved
}

/** Recursive directory listing helper confined to the workspace */
export async function listDirFiles(dir: string, recursive = true): Promise<string[]> {
  const resolvedDir = resolveInWorkspace(dir)
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const res = path.resolve(resolvedDir, entry.name)
      if (entry.isDirectory()) {
        // Skip common ignore patterns to be efficient and secure
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') {
          return []
        }
        return recursive ? listDirFiles(res, recursive) : [res]
      } else {
        return [res]
      }
    })
  )
  return files.flat().filter(Boolean)
}

/** DuckDuckGo HTML Search Scraper with strict timeout and no backtracking regexes */
export async function performWebSearch(query: string): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
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

/** Resolves hostnames via DNS and blocks SSRF / local IP address ranges */
export async function isValidUrl(urlStr: string): Promise<boolean> {
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname.toLowerCase()

    // If it's already an IP address, check it. If it's a hostname, resolve it via DNS first.
    let ipAddresses: string[] = []
    if (/^[0-9.]+$/.test(hostname) || hostname.includes(':')) {
      ipAddresses.push(hostname)
    } else {
      try {
        const lookup = await dns.promises.lookup(hostname, { all: true })
        ipAddresses = lookup.map(addr => addr.address)
      } catch {
        // DNS lookup failure: reject to remain secure
        return false
      }
    }

    for (const ip of ipAddresses) {
      // Loopback
      if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1') return false
      // Private Class A, B, C, link-local
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return false
      if (ip.startsWith('172.')) {
        const parts = ip.split('.')
        const second = parseInt(parts[1], 10)
        if (second >= 16 && second <= 31) return false
      }
      // IPv6 local addresses
      if (ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fdfd:')) return false
    }
    return true
  } catch {
    return false
  }
}

/** Parses shell command arguments correctly while respecting quoted strings */
export function parseCommandArgs(command: string): string[] {
  const args: string[] = []
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = regex.exec(command)) !== null) {
    args.push(match[1] || match[2] || match[3])
  }
  return args
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

  try {
    const provider = await resolveProviderForMode(userId, mode)
    const { client, type, getConfig } = await createAIClient(provider.id)

    // Helper to send a prompt and receive a structured response.
    const askModel = async (messages: Message[]): Promise<string> => {
      const cfg = getConfig()

      // Trim/summarize conversation growth to stay securely within the context window
      // Keeps the system message, initial prompt, and last 4 assistant-user turns
      let contextMessages = [...messages]
      if (contextMessages.length > 10) {
        const sysMsg = contextMessages[0]
        const firstUserMsg = contextMessages[1]
        const recentHistory = contextMessages.slice(-8)
        contextMessages = [sysMsg, firstUserMsg, ...recentHistory]
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
            const targetPath = act.path ? resolveInWorkspace(act.path) : WORKSPACE_ROOT
            const files = await listDirFiles(targetPath, true)
            const results: Array<{ path: string; line: number; text: string }> = []

            // Construct RegExp with guarded error handling
            let patternRegex: RegExp
            try {
              patternRegex = new RegExp(act.pattern)
            } catch (err: any) {
              const escaped = act.pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
              patternRegex = new RegExp(escaped)
            }

            for (const f of files) {
              try {
                const stat = await fs.stat(f)
                if (stat.size > 1024 * 1024) continue // Skip large files > 1MB
                const content = await fs.readFile(f, 'utf8')
                const lines = content.split('\n')
                lines.forEach((lineText, idx) => {
                  if (patternRegex.test(lineText)) {
                    results.push({
                      path: path.relative(targetPath, f),
                      line: idx + 1,
                      text: lineText.trim()
                    })
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
            const allowedPrograms = ['npm', 'node', 'npx', 'prisma', 'echo', 'ls', 'pwd', 'git', 'cat', 'grep', 'mkdir']
            if (!allowedPrograms.includes(program)) {
              throw new Error(`Command '${program}' is not allowed for security reasons.`)
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

            const response = await fetch(url, { signal: AbortSignal.timeout(5000) })

            const contentLengthStr = response.headers.get('content-length')
            if (contentLengthStr) {
              const cl = parseInt(contentLengthStr, 10)
              if (cl > 5 * 1024 * 1024) {
                throw new Error('Response Content-Length exceeds the 5MB limit.')
              }
            }

            // Stream and limit response consumption so response.text() cannot buffer unbounded payload
            let bodyText = ''
            if (response.body && typeof (response.body as any)[Symbol.asyncIterator] === 'function') {
              let totalBytes = 0
              for await (const chunk of response.body as any) {
                bodyText += chunk.toString()
                totalBytes += chunk.length
                if (totalBytes > 500000) { // cap at 500KB
                  break
                }
              }
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
            const npmRegex = /^@?[a-z0-9-_.]+([/@][a-z0-9-_.]+)*$/
            const validatedNames = act.packages.filter((pkg: string) => npmRegex.test(pkg))
            if (validatedNames.length !== act.packages.length) {
              throw new Error(`Invalid package name format detected in packages.`)
            }

            const { stdout, stderr } = await execFilePromise('npm', ['install', ...validatedNames], { timeout: 60000 })
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
            // Setup Chromium browser instance if it is not already running
            if (!browserInstance) {
              browserInstance = await puppeteer.launch({
                executablePath: '/usr/bin/google-chrome',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
              })
              pageInstance = await browserInstance.newPage()
              await pageInstance.setViewport({ width: 1280, height: 800 })

              // Listen to real-time console messages and log them
              pageInstance.on('console', (msg: any) => {
                const logStr = `[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`
                consoleLogs.push(logStr)
              })
            }

            const url = act.url
            await pageInstance.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

            // Capture a high-resolution screenshot
            const screenshotPath = path.resolve(process.cwd(), 'screenshot_navigate.png')
            await pageInstance.screenshot({ path: screenshotPath, fullPage: true })

            const pageTitle = await pageInstance.title()
            const auditReport = {
              title: pageTitle,
              url,
              screenshot: screenshotPath,
              consoleLogs: consoleLogs,
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

            const screenshotPath = path.resolve(process.cwd(), 'screenshot_click.png')
            await pageInstance.screenshot({ path: screenshotPath, fullPage: true })

            const auditReport = {
              selector,
              screenshot: screenshotPath,
              consoleLogs: consoleLogs,
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

            const screenshotPath = path.resolve(process.cwd(), 'screenshot_type.png')
            await pageInstance.screenshot({ path: screenshotPath, fullPage: true })

            const auditReport = {
              selector,
              text,
              screenshot: screenshotPath,
              consoleLogs: consoleLogs,
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
    return res.status(500).json({
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

  if (!provider) throw new Error(`No active AI provider configured for mode ${mode}`)
  return provider
}
