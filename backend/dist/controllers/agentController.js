"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.execPromise = execPromise;
exports.execFilePromise = execFilePromise;
exports.resolveInWorkspace = resolveInWorkspace;
exports.listDirFiles = listDirFiles;
exports.performWebSearch = performWebSearch;
exports.parseIpv4ToLong = parseIpv4ToLong;
exports.isValidUrl = isValidUrl;
exports.parseCommandArgs = parseCommandArgs;
exports.getSafeRegExp = getSafeRegExp;
exports.runAgent = runAgent;
const aiFactory_1 = require("../services/aiFactory");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const dns_1 = __importDefault(require("dns"));
const client_1 = require("@prisma/client");
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
// Instantiate a single global Prisma client to prevent connection pool leaks
const prisma = new client_1.PrismaClient();
/** Promisified exec with secure finite default timeout and 10MB maxBuffer options */
function execPromise(cmd, options = {}) {
    const defaultOptions = { timeout: 30000, maxBuffer: 10 * 1024 * 1024 };
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(cmd, { encoding: 'utf8', ...defaultOptions, ...options }, (error, stdout, stderr) => {
            if (error) {
                const errInstance = new Error(error.message);
                errInstance.stdout = stdout || '';
                errInstance.stderr = stderr || '';
                errInstance.originalError = error;
                return reject(errInstance);
            }
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
}
/** Promisified execFile with secure finite default timeout and 10MB maxBuffer options */
function execFilePromise(file, args, options = {}) {
    const defaultOptions = { timeout: 30000, maxBuffer: 10 * 1024 * 1024 };
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(file, args, { encoding: 'utf8', ...defaultOptions, ...options }, (error, stdout, stderr) => {
            if (error) {
                const errInstance = new Error(error.message);
                errInstance.stdout = stdout || '';
                errInstance.stderr = stderr || '';
                errInstance.originalError = error;
                return reject(errInstance);
            }
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
}
const WORKSPACE_ROOT = process.cwd();
/** Confines path resolutions strictly to the workspace root using path-segment-aware relative checks */
function resolveInWorkspace(requestedPath) {
    const resolved = path_1.default.resolve(WORKSPACE_ROOT, requestedPath);
    const relative = path_1.default.relative(WORKSPACE_ROOT, resolved);
    // Reject relative paths equal to ".." or beginning with ".." plus separator to stop traversal or sibling escapes
    if (relative === '..' || relative.startsWith('..' + path_1.default.sep)) {
        throw new Error(`Directory traversal attempt detected: ${requestedPath}`);
    }
    return resolved;
}
/** Recursive directory listing helper confined to the workspace */
async function listDirFiles(dir, recursive = true) {
    const resolvedDir = resolveInWorkspace(dir);
    const entries = await fs_1.promises.readdir(resolvedDir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const res = path_1.default.resolve(resolvedDir, entry.name);
        if (entry.isDirectory()) {
            // Skip common ignore patterns to be efficient and secure
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') {
                return [];
            }
            return recursive ? listDirFiles(res, recursive) : [res];
        }
        else {
            return [res];
        }
    }));
    return files.flat().filter(Boolean);
}
/** DuckDuckGo HTML Search Scraper with strict timeout and no backtracking regexes */
async function performWebSearch(query) {
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok)
            throw new Error(`DuckDuckGo returned status ${res.status}`);
        const html = await res.text();
        // Scrape snippets using non-backtracking regexes
        const snippets = [];
        const snippetMatches = html.matchAll(/<a class="result__snippet"[^>]*>([^<]*)<\/a>/g);
        for (const match of snippetMatches) {
            const text = match[1].trim();
            if (text)
                snippets.push(text);
        }
        const titles = [];
        const titleMatches = html.matchAll(/<a class="result__url"[^>]*>([^<]*)<\/a>/g);
        for (const match of titleMatches) {
            const text = match[1].trim();
            if (text)
                titles.push(text);
        }
        if (snippets.length > 0) {
            return snippets.slice(0, 5).map((s, i) => `[Result ${i + 1}] Title: ${titles[i] || 'Web Page'}\nSnippet: ${s}`).join('\n\n');
        }
        return `Search for "${query}" completed, but could not parse search result snippets.`;
    }
    catch (err) {
        console.error('Web search failed:', err);
        return `Error: Web search could not be completed. Details: ${err.message || err}`;
    }
}
/** Parses IPv4 block to long integer value for exact numeric range validation */
function parseIpv4ToLong(ip) {
    if (/^\d+$/.test(ip)) {
        return parseInt(ip, 10);
    }
    const parts = ip.split('.');
    if (parts.length !== 4)
        return null;
    let long = 0;
    for (let i = 0; i < 4; i++) {
        const val = parseInt(parts[i], 10);
        if (isNaN(val) || val < 0 || val > 255)
            return null;
        long = (long << 8) + val;
    }
    return long >>> 0;
}
/** Resolves hostnames via DNS and blocks SSRF / local IP address ranges */
async function isValidUrl(urlStr, allowLoopback = false) {
    try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return false;
        const hostname = parsed.hostname.toLowerCase();
        // If it's already an IP address, check it. If it's a hostname, resolve it via DNS resolver (safe & non-blocking) first.
        let ipAddresses = [];
        if (/^[0-9.]+$/.test(hostname) || hostname.includes(':')) {
            ipAddresses.push(hostname);
        }
        else {
            try {
                const ips = await dns_1.default.promises.resolve4(hostname).catch(() => []);
                const ip6s = await dns_1.default.promises.resolve6(hostname).catch(() => []);
                ipAddresses = [...ips, ...ip6s];
                if (ipAddresses.length === 0) {
                    return false;
                }
            }
            catch {
                // DNS lookup failure: reject to remain secure
                return false;
            }
        }
        for (let ip of ipAddresses) {
            // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
            if (ip.startsWith('::ffff:')) {
                ip = ip.substring(7);
            }
            const ipLong = parseIpv4ToLong(ip);
            if (ipLong !== null) {
                // Check ranges via long integer representation:
                // 127.0.0.0/8 (127.0.0.0 to 127.255.255.255) -> 2130706432 to 2147483647
                if (ipLong >= 2130706432 && ipLong <= 2147483647) {
                    return allowLoopback;
                }
                // 10.0.0.0/8 (10.0.0.0 to 10.255.255.255) -> 167772160 to 184549375
                if (ipLong >= 167772160 && ipLong <= 184549375)
                    return false;
                // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255) -> 2886729728 to 2887778303
                if (ipLong >= 2886729728 && ipLong <= 2887778303)
                    return false;
                // 192.168.0.0/16 (192.168.0.0 to 192.168.255.255) -> 3232235520 to 3232301055
                if (ipLong >= 3232235520 && ipLong <= 3232301055)
                    return false;
                // 100.64.0.0/10 (100.64.0.0 to 100.127.255.255) -> 1682046976 to 1686241279
                if (ipLong >= 1682046976 && ipLong <= 1686241279)
                    return false;
                // 169.254.0.0/16 (169.254.0.0 to 169.254.255.255) -> 2851995648 to 2852061183
                if (ipLong >= 2851995648 && ipLong <= 2852061183)
                    return false;
            }
            else {
                // IPv6 validation
                const normalizedv6 = ip.toLowerCase();
                if (normalizedv6 === '::1' || normalizedv6 === '::') {
                    return allowLoopback;
                }
                // Unique Local Addresses (fc00::/7)
                if (normalizedv6.startsWith('fc') || normalizedv6.startsWith('fd'))
                    return false;
                // Link local (fe80::/10)
                if (normalizedv6.startsWith('fe8') || normalizedv6.startsWith('fe9') || normalizedv6.startsWith('fea') || normalizedv6.startsWith('feb'))
                    return false;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
/** Parses shell command arguments correctly while respecting empty/quoted strings using nullish coalescing */
function parseCommandArgs(command) {
    const args = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = regex.exec(command)) !== null) {
        args.push(match[1] ?? match[2] ?? match[3]);
    }
    return args;
}
/** Constructs a safe RegExp from user input, escaping dangerous ReDoS combinations */
function getSafeRegExp(pattern) {
    const isUnsafe = pattern.length > 50 ||
        /\([^)]*[*+?][^)]*\)[*+?]/.test(pattern) ||
        /.*[*+?]{2,}/.test(pattern);
    if (isUnsafe) {
        const escaped = pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return new RegExp(escaped);
    }
    try {
        return new RegExp(pattern);
    }
    catch {
        const escaped = pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return new RegExp(escaped);
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
async function runAgent(req, res) {
    const { prompt, mode, userId } = req.body;
    if (!prompt || !mode || !userId) {
        return res.status(400).json({ error: 'Missing prompt, mode or userId' });
    }
    const allowedModes = ['lite', 'economy', 'power', 'turbo'];
    if (!allowedModes.includes(mode)) {
        return res.status(400).json({ error: `Invalid mode value: ${mode}` });
    }
    let browserInstance = null;
    let pageInstance = null;
    const consoleLogs = [];
    let lastConsoleLogIdx = 0;
    try {
        const provider = await resolveProviderForMode(userId, mode);
        const { client, type, getConfig } = await (0, aiFactory_1.createAIClient)(provider.id);
        // Helper to send a prompt and receive a structured response.
        const askModel = async (messages) => {
            const cfg = getConfig();
            // Trim/summarize conversation growth to stay securely within the context window character budget
            const CHARACTER_BUDGET = 30000;
            let contextMessages = [...messages];
            let currentTotalChars = contextMessages.reduce((sum, m) => sum + m.content.length, 0);
            if (currentTotalChars > CHARACTER_BUDGET) {
                const sysMsg = contextMessages[0];
                const userMsg = contextMessages[1];
                const historyMsgs = contextMessages.slice(2);
                // We scan backwards keeping the newest message history first to fit inside the character budget
                const keptHistory = [];
                let budgetLeft = CHARACTER_BUDGET - sysMsg.content.length - userMsg.content.length;
                for (let i = historyMsgs.length - 1; i >= 0; i--) {
                    const msg = historyMsgs[i];
                    if (budgetLeft > 0) {
                        if (msg.content.length > budgetLeft) {
                            msg.content = msg.content.substring(0, budgetLeft) + '\n[Truncated to fit context budget...]';
                        }
                        keptHistory.unshift(msg);
                        budgetLeft -= msg.content.length;
                    }
                    else {
                        break;
                    }
                }
                contextMessages = [sysMsg, userMsg, ...keptHistory];
            }
            // Send message list to appropriate client SDK
            if (type === aiFactory_1.ProviderType.OPENAI || type === aiFactory_1.ProviderType.GENERIC_REST) {
                const response = await client.chat.completions.create({
                    model: cfg.modelName,
                    messages: contextMessages,
                    max_tokens: cfg.maxTokens,
                    temperature: cfg.temperature
                });
                return response.choices[0].message.content;
            }
            else if (type === aiFactory_1.ProviderType.ANTHROPIC) {
                // Extract system prompt from the first message if present
                const sysMsg = contextMessages.find(m => m.role === 'system');
                const systemPrompt = sysMsg ? sysMsg.content : undefined;
                const filteredMessages = contextMessages.filter(m => m.role !== 'system');
                const response = await client.messages.create({
                    model: cfg.modelName,
                    max_tokens: cfg.maxTokens,
                    temperature: cfg.temperature,
                    messages: filteredMessages,
                    system: systemPrompt
                });
                return response.content[0].text;
            }
            else {
                // Fallback REST caller
                const resp = await client.chat({ messages: contextMessages, max_tokens: cfg.maxTokens });
                return resp.choices[0].message.content;
            }
        };
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
}`;
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
        ];
        const MAX_ITERATIONS = 10;
        let executedActionsList = [];
        for (let i = 0; i < MAX_ITERATIONS; i++) {
            const rawResponse = await askModel(messages);
            // Add assistant response to messages
            messages.push({ role: 'assistant', content: rawResponse });
            let parsed;
            try {
                let cleanedJson = rawResponse.trim();
                const fenceRegex = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i;
                const match = cleanedJson.match(fenceRegex);
                if (match) {
                    cleanedJson = match[1].trim();
                }
                parsed = JSON.parse(cleanedJson);
            }
            catch (e) {
                messages.push({
                    role: 'user',
                    content: `Error: Your last response was not valid JSON. Please repeat and format strictly as JSON.\nRaw output was:\n${rawResponse}`
                });
                continue;
            }
            // Filtered history that removes system messages and raw tool results before returning to client
            const filteredHistory = messages.filter(m => m.role !== 'system' &&
                !(m.role === 'user' && m.content.startsWith('Executed ')));
            // 1. Check for clarifying questions
            if (parsed.question) {
                return res.json({ question: parsed.question, history: filteredHistory });
            }
            // 2. Check for completion
            if (parsed.done) {
                return res.json({
                    success: true,
                    done: true,
                    finalMessage: parsed.finalMessage || 'Task completed successfully!',
                    history: filteredHistory,
                    executedActions: executedActionsList
                });
            }
            const actions = parsed.actions;
            if (!actions || actions.length === 0) {
                return res.json({
                    success: true,
                    result: 'No actions required, loop completed.',
                    history: filteredHistory,
                    executedActions: executedActionsList
                });
            }
            // 3. Execute actions in order and capture outputs
            const actionResults = [];
            for (const act of actions) {
                const resultItem = { type: act.type, path: act.path || act.selector || '' };
                try {
                    if (act.type === 'readFile') {
                        const absolutePath = resolveInWorkspace(act.path);
                        let content = await fs_1.promises.readFile(absolutePath, 'utf8');
                        // Context Budget constraints: Truncate output to prevent context bloating
                        if (content.length > 5000) {
                            content = content.substring(0, 5000) + '\n[Output truncated due to context size limit...]';
                        }
                        resultItem.status = 'success';
                        resultItem.output = content;
                    }
                    else if (act.type === 'writeFile') {
                        const absolutePath = resolveInWorkspace(act.path);
                        await fs_1.promises.mkdir(path_1.default.dirname(absolutePath), { recursive: true });
                        await fs_1.promises.writeFile(absolutePath, act.content, 'utf8');
                        resultItem.status = 'success';
                        resultItem.output = 'File written successfully.';
                    }
                    else if (act.type === 'patchFile') {
                        const absolutePath = resolveInWorkspace(act.path);
                        const content = await fs_1.promises.readFile(absolutePath, 'utf8');
                        if (!content.includes(act.search)) {
                            throw new Error(`Search block not found in file: ${act.path}`);
                        }
                        const newContent = content.replace(act.search, act.replace);
                        await fs_1.promises.writeFile(absolutePath, newContent, 'utf8');
                        resultItem.status = 'success';
                        resultItem.output = 'File patched successfully.';
                    }
                    else if (act.type === 'deleteFile') {
                        const absolutePath = resolveInWorkspace(act.path);
                        await fs_1.promises.unlink(absolutePath);
                        resultItem.status = 'success';
                        resultItem.output = 'File deleted successfully.';
                    }
                    else if (act.type === 'makeDirectory') {
                        const absolutePath = resolveInWorkspace(act.path);
                        await fs_1.promises.mkdir(absolutePath, { recursive: true });
                        resultItem.status = 'success';
                        resultItem.output = 'Directory created successfully.';
                    }
                    else if (act.type === 'listFiles') {
                        const targetPath = act.path ? resolveInWorkspace(act.path) : WORKSPACE_ROOT;
                        const allFiles = await listDirFiles(targetPath, act.recursive !== false);
                        const relativeFiles = allFiles.map(f => path_1.default.relative(targetPath, f));
                        resultItem.status = 'success';
                        resultItem.output = JSON.stringify(relativeFiles, null, 2);
                    }
                    else if (act.type === 'searchFiles') {
                        // Reject overly long or unsafe pattern sizes
                        if (act.pattern && act.pattern.length > 100) {
                            throw new Error('Search pattern exceeds secure limit of 100 characters.');
                        }
                        const targetPath = act.path ? resolveInWorkspace(act.path) : WORKSPACE_ROOT;
                        const files = await listDirFiles(targetPath, true);
                        const results = [];
                        // Construct safe RegExp
                        const patternRegex = getSafeRegExp(act.pattern);
                        let scannedFilesCount = 0;
                        let totalMatchesFound = 0;
                        for (const f of files) {
                            scannedFilesCount++;
                            if (scannedFilesCount > 100 || totalMatchesFound > 200) {
                                break;
                            }
                            try {
                                const stat = await fs_1.promises.stat(f);
                                if (stat.size > 1024 * 1024)
                                    continue; // Skip large files > 1MB
                                const content = await fs_1.promises.readFile(f, 'utf8');
                                const lines = content.split('\n');
                                lines.forEach((lineText, idx) => {
                                    if (patternRegex.test(lineText)) {
                                        totalMatchesFound++;
                                        if (totalMatchesFound <= 200) {
                                            results.push({
                                                path: path_1.default.relative(targetPath, f),
                                                line: idx + 1,
                                                text: lineText.trim()
                                            });
                                        }
                                    }
                                });
                            }
                            catch (e) {
                                // Ignore read errors
                            }
                        }
                        let outputStr = JSON.stringify(results, null, 2);
                        if (outputStr.length > 5000) {
                            outputStr = outputStr.substring(0, 5000) + '\n[Output truncated due to context size limit...]';
                        }
                        resultItem.status = 'success';
                        resultItem.output = outputStr;
                    }
                    else if (act.type === 'runShell') {
                        const args = parseCommandArgs(act.command);
                        const program = args[0];
                        const programArgs = args.slice(1);
                        const allowedSubcommands = {
                            'npm': ['install', 'run', 'test', 'build'],
                            'prisma': ['generate', 'db', 'migrate'],
                            'git': ['status', 'add', 'restore', 'log', 'diff'],
                            'echo': [],
                            'ls': [],
                            'pwd': [],
                            'cat': [],
                            'mkdir': []
                        };
                        if (!allowedSubcommands.hasOwnProperty(program)) {
                            throw new Error(`Program '${program}' is not allowlisted.`);
                        }
                        const allowedSubs = allowedSubcommands[program];
                        if (allowedSubs.length > 0) {
                            const sub = args[1];
                            if (!allowedSubs.includes(sub)) {
                                throw new Error(`Subcommand '${sub}' is not allowed for program '${program}'.`);
                            }
                        }
                        // Reject disallowed security-sensitive options starting with "-"
                        const disallowedArgsRegex = /^(-e|--eval|--exec|-c|--config)$/i;
                        for (const arg of args.slice(1)) {
                            if (disallowedArgsRegex.test(arg)) {
                                throw new Error(`Disallowed security-sensitive argument pattern detected: ${arg}`);
                            }
                        }
                        const { stdout, stderr } = await execFilePromise(program, programArgs, { timeout: 15000 });
                        resultItem.status = 'success';
                        resultItem.output = `Stdout:\n${stdout}\nStderr:\n${stderr}`;
                    }
                    else if (act.type === 'webSearch') {
                        const searchOutput = await performWebSearch(act.query);
                        resultItem.status = 'success';
                        resultItem.output = searchOutput;
                    }
                    else if (act.type === 'fetchUrl') {
                        const url = act.url;
                        const valid = await isValidUrl(url);
                        if (!valid) {
                            throw new Error(`Request blocked: Invalid or non-whitelisted URL address.`);
                        }
                        const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
                        const contentLengthStr = response.headers.get('content-length');
                        if (contentLengthStr) {
                            const cl = parseInt(contentLengthStr, 10);
                            if (cl > 5 * 1024 * 1024) {
                                throw new Error('Response Content-Length exceeds the 5MB limit.');
                            }
                        }
                        // Stream and limit response consumption so response.text() cannot buffer unbounded payload
                        let bodyText = '';
                        if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
                            let totalBytes = 0;
                            for await (const chunk of response.body) {
                                bodyText += chunk.toString();
                                totalBytes += chunk.length;
                                if (totalBytes > 500000) { // cap at 500KB
                                    break;
                                }
                            }
                        }
                        else {
                            bodyText = await response.text();
                        }
                        // Clean up heavy tags
                        const cleaned = bodyText
                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        resultItem.status = 'success';
                        resultItem.output = cleaned.substring(0, 10000);
                    }
                    else if (act.type === 'installPackages') {
                        // Require each package name to begin with letter, digit, or @, and reject package entries starting with "-"
                        const npmRegex = /^[a-zA-Z0-9@][a-zA-Z0-9-_.]*([/@][a-zA-Z0-9-_.]+)*$/;
                        const validatedNames = act.packages.filter((pkg) => npmRegex.test(pkg));
                        if (validatedNames.length !== act.packages.length) {
                            throw new Error(`Invalid package name format detected in packages.`);
                        }
                        const { stdout, stderr } = await execFilePromise('npm', ['install', ...validatedNames], { timeout: 60000 });
                        resultItem.status = 'success';
                        resultItem.output = `Stdout:\n${stdout}\nStderr:\n${stderr}`;
                    }
                    else if (act.type === 'getServiceStatus') {
                        const osInfo = {
                            platform: os_1.default.platform(),
                            arch: os_1.default.arch(),
                            release: os_1.default.release(),
                            uptime: os_1.default.uptime(),
                            freeMem: os_1.default.freemem(),
                            totalMem: os_1.default.totalmem(),
                            cwd: process.cwd(),
                            env: {
                                PORT: process.env.PORT,
                                NODE_ENV: process.env.NODE_ENV
                            }
                        };
                        resultItem.status = 'success';
                        resultItem.output = JSON.stringify(osInfo, null, 2);
                    }
                    else if (act.type === 'browserNavigate') {
                        // Validate URL before navigating: permit http/https schemes, loopbacks only for local preview
                        const url = act.url;
                        const valid = await isValidUrl(url, true); // allow loopback for local-previews
                        if (!valid) {
                            throw new Error(`Request blocked: Invalid or non-whitelisted URL address.`);
                        }
                        // Setup Chromium browser instance if it is not already running
                        if (!browserInstance) {
                            const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';
                            const pathExists = await fs_1.promises.stat(execPath).then(() => true).catch(() => false);
                            if (!pathExists) {
                                throw new Error(`Puppeteer executable not found at specified path: ${execPath}`);
                            }
                            browserInstance = await puppeteer_core_1.default.launch({
                                executablePath: execPath,
                                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
                            });
                            pageInstance = await browserInstance.newPage();
                            await pageInstance.setViewport({ width: 1280, height: 800 });
                            // Listen to real-time console messages and log them
                            pageInstance.on('console', (msg) => {
                                const logStr = `[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`;
                                consoleLogs.push(logStr);
                            });
                        }
                        await pageInstance.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        // Generate unique screenshot filename securely under resolveInWorkspace
                        const filename = `screenshot_${Date.now()}_navigate.png`;
                        const screenshotPath = resolveInWorkspace(filename);
                        await pageInstance.screenshot({ path: screenshotPath, fullPage: true });
                        // Correct relative log slicing with end bound (preventing empty console logs after 100 entries)
                        const logsSegment = consoleLogs.slice(lastConsoleLogIdx, lastConsoleLogIdx + 100);
                        lastConsoleLogIdx = consoleLogs.length;
                        const pageTitle = await pageInstance.title();
                        const auditReport = {
                            title: pageTitle,
                            url,
                            screenshot: screenshotPath,
                            consoleLogs: logsSegment,
                            status: 'success'
                        };
                        resultItem.status = 'success';
                        resultItem.output = JSON.stringify(auditReport, null, 2);
                    }
                    else if (act.type === 'browserInteractClick') {
                        if (!pageInstance) {
                            throw new Error('No active browser page session. Please run browserNavigate first.');
                        }
                        const selector = act.selector;
                        await pageInstance.waitForSelector(selector, { timeout: 10000 });
                        await pageInstance.click(selector);
                        // Wait for visual transitions/loads
                        await new Promise(r => setTimeout(r, 1000));
                        // Generate unique screenshot filename securely under resolveInWorkspace
                        const filename = `screenshot_${Date.now()}_click.png`;
                        const screenshotPath = resolveInWorkspace(filename);
                        await pageInstance.screenshot({ path: screenshotPath, fullPage: true });
                        // Correct relative log slicing with end bound
                        const logsSegment = consoleLogs.slice(lastConsoleLogIdx, lastConsoleLogIdx + 100);
                        lastConsoleLogIdx = consoleLogs.length;
                        const auditReport = {
                            selector,
                            screenshot: screenshotPath,
                            consoleLogs: logsSegment,
                            status: 'success'
                        };
                        resultItem.status = 'success';
                        resultItem.output = JSON.stringify(auditReport, null, 2);
                    }
                    else if (act.type === 'browserInteractType') {
                        if (!pageInstance) {
                            throw new Error('No active browser page session. Please run browserNavigate first.');
                        }
                        const selector = act.selector;
                        const text = act.text;
                        await pageInstance.waitForSelector(selector, { timeout: 10000 });
                        // Clear input first
                        await pageInstance.click(selector, { clickCount: 3 });
                        await pageInstance.keyboard.press('Backspace');
                        // Type key-by-key like a real keyboard input
                        await pageInstance.type(selector, text, { delay: 100 });
                        // Wait for actions to register
                        await new Promise(r => setTimeout(r, 500));
                        // Generate unique screenshot filename securely under resolveInWorkspace
                        const filename = `screenshot_${Date.now()}_type.png`;
                        const screenshotPath = resolveInWorkspace(filename);
                        await pageInstance.screenshot({ path: screenshotPath, fullPage: true });
                        // Correct relative log slicing with end bound
                        const logsSegment = consoleLogs.slice(lastConsoleLogIdx, lastConsoleLogIdx + 100);
                        lastConsoleLogIdx = consoleLogs.length;
                        const auditReport = {
                            selector,
                            text,
                            screenshot: screenshotPath,
                            consoleLogs: logsSegment,
                            status: 'success'
                        };
                        resultItem.status = 'success';
                        resultItem.output = JSON.stringify(auditReport, null, 2);
                    }
                    else {
                        throw new Error(`Unsupported action type: ${act.type}`);
                    }
                }
                catch (err) {
                    resultItem.status = 'failure';
                    resultItem.output = err.message || 'Unknown error occurred.';
                }
                actionResults.push(resultItem);
                executedActionsList.push(resultItem);
            }
            // Append all action results back to user messages for the next LLM turn
            messages.push({
                role: 'user',
                content: `Executed ${actionResults.length} actions. Results:\n` +
                    actionResults.map((r, idx) => `Action #${idx + 1} (${r.type} ${r.path || ''}):\nStatus: ${r.status}\nOutput:\n${r.output}`).join('\n\n')
            });
        }
        // Filtered history that removes system messages and raw tool results before returning to client
        const filteredHistory = messages.filter(m => m.role !== 'system' &&
            !(m.role === 'user' && m.content.startsWith('Executed ')));
        // Exhausted iterations without success.
        return res.status(500).json({
            error: 'Agent failed to converge after maximum retries.',
            history: filteredHistory,
            executedActions: executedActionsList
        });
    }
    catch (err) {
        console.error('Agent error:', err);
        return res.status(500).json({ error: err.message });
    }
    finally {
        // Gracefully close any leftover headless browser instance to prevent process leak
        if (browserInstance) {
            await browserInstance.close().catch(() => { });
        }
    }
}
/** Resolve the appropriate AIProvider record for a given user+mode */
async function resolveProviderForMode(userId, mode) {
    const mapField = {
        lite: 'liteModel',
        economy: 'economyModel',
        power: 'powerModel',
        turbo: 'turboModel'
    }[mode];
    // Find a provider where the chosen model field is not null and is active.
    const whereFilter = {
        userId,
        isActive: true
    };
    whereFilter[mapField] = { not: null };
    const provider = await prisma.aIProvider.findFirst({
        where: whereFilter,
        orderBy: { updatedAt: 'desc' }
    });
    if (!provider)
        throw new Error(`No active AI provider configured for mode ${mode}`);
    return provider;
}
