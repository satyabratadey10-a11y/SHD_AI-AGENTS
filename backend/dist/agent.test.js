"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const dns_1 = __importDefault(require("dns"));
const fs_1 = require("fs");
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const agentController_1 = require("./controllers/agentController");
(0, node_test_1.default)('resolveInWorkspace path validation and traversal prevention', () => {
    // Safe paths
    const safePath1 = (0, agentController_1.resolveInWorkspace)('src/server.ts');
    node_assert_1.default.ok(safePath1.endsWith('src/server.ts'));
    const safePath2 = (0, agentController_1.resolveInWorkspace)('./package.json');
    node_assert_1.default.ok(safePath2.endsWith('package.json'));
    // Directory traversal attempts (must throw)
    node_assert_1.default.throws(() => {
        (0, agentController_1.resolveInWorkspace)('../../../etc/passwd');
    }, /Directory traversal attempt detected/);
    node_assert_1.default.throws(() => {
        (0, agentController_1.resolveInWorkspace)('/absolute/outside/workspace');
    }, /Directory traversal attempt detected/);
    // Update: sibling-prefix path traversal escape test
    node_assert_1.default.throws(() => {
        (0, agentController_1.resolveInWorkspace)('../workspace-secrets');
    }, /Directory traversal attempt detected/);
});
(0, node_test_1.default)('listDirFiles utility', async () => {
    // Update: Pass __dirname directly as requested, while preserving assertions
    const files = await (0, agentController_1.listDirFiles)(__dirname, true);
    node_assert_1.default.ok(files.length > 0, 'Should find files recursively');
    const hasTestFile = files.some(f => f.endsWith('agent.test.ts') || f.endsWith('agent.test.js'));
    node_assert_1.default.ok(hasTestFile, 'Should find this test file in the listing');
});
(0, node_test_1.default)('performWebSearch utility with stubbed fetch (success)', async () => {
    const originalFetch = global.fetch;
    // Stub global.fetch with deterministic DuckDuckGo HTML
    global.fetch = async (url) => {
        return {
            ok: true,
            status: 200,
            text: async () => `
        <html>
          <body>
            <a class="result__snippet" href="/r1">Retrieval evidence snippet text.</a>
            <a class="result__url" href="/r1">https://example.com/topic</a>
          </body>
        </html>
      `
        };
    };
    try {
        const output = await (0, agentController_1.performWebSearch)('TypeScript');
        node_assert_1.default.ok(output.includes('Retrieval evidence snippet text.'), 'Parsed search output should contain stubbed snippet text');
        node_assert_1.default.ok(output.includes('https://example.com/topic'), 'Parsed search output should contain stubbed title');
    }
    finally {
        global.fetch = originalFetch;
    }
});
(0, node_test_1.default)('performWebSearch utility (failure branch)', async () => {
    const originalFetch = global.fetch;
    // Stub global.fetch to simulate a failure
    global.fetch = async (url) => {
        return {
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error'
        };
    };
    try {
        const output = await (0, agentController_1.performWebSearch)('TypeScript');
        node_assert_1.default.ok(output.includes('Error: Web search could not be completed'), 'Failure branch should indicate web search could not be completed');
    }
    finally {
        global.fetch = originalFetch;
    }
});
(0, node_test_1.default)('execPromise execution utility', async () => {
    const result = await (0, agentController_1.execPromise)('echo Hello Agent');
    node_assert_1.default.strictEqual(result.stdout.trim(), 'Hello Agent', 'Should capture stdout of echo Hello Agent command');
});
(0, node_test_1.default)('isValidUrl SSRF and DNS verification utility with mocked DNS', async () => {
    // Update: Avoid live DNS resolution by stubbing dns.promises.resolve4 and resolve6
    const originalResolve4 = dns_1.default.promises.resolve4;
    const originalResolve6 = dns_1.default.promises.resolve6;
    dns_1.default.promises.resolve4 = (async (hostname) => {
        if (hostname === 'example.com' || hostname === 'google.com') {
            return ['93.184.216.34'];
        }
        if (hostname === 'bad-dns-rebind.com') {
            return ['127.0.0.1'];
        }
        if (hostname === 'private-host.local') {
            return ['10.0.0.1'];
        }
        throw new Error('DNS lookup failed');
    });
    dns_1.default.promises.resolve6 = (async (hostname) => {
        return [];
    });
    try {
        // Test valid public endpoints (should pass)
        node_assert_1.default.ok(await (0, agentController_1.isValidUrl)('https://example.com'));
        node_assert_1.default.ok(await (0, agentController_1.isValidUrl)('http://google.com/search'));
        // Test local IP address ranges & loopbacks (must be blocked)
        node_assert_1.default.strictEqual(await (0, agentController_1.isValidUrl)('http://127.0.0.1:3000'), false);
        node_assert_1.default.strictEqual(await (0, agentController_1.isValidUrl)('http://localhost:8080'), false);
        node_assert_1.default.strictEqual(await (0, agentController_1.isValidUrl)('https://10.0.0.1'), false);
        node_assert_1.default.strictEqual(await (0, agentController_1.isValidUrl)('http://192.168.1.1'), false);
        node_assert_1.default.strictEqual(await (0, agentController_1.isValidUrl)('http://169.254.169.254'), false);
        // Test mocked malicious DNS rebinding attempt (must be blocked)
        node_assert_1.default.strictEqual(await (0, agentController_1.isValidUrl)('http://bad-dns-rebind.com:8080'), false);
        node_assert_1.default.strictEqual(await (0, agentController_1.isValidUrl)('http://private-host.local/docs'), false);
    }
    finally {
        dns_1.default.promises.resolve4 = originalResolve4;
        dns_1.default.promises.resolve6 = originalResolve6;
    }
});
(0, node_test_1.default)('parseCommandArgs shell command parser', () => {
    const args = (0, agentController_1.parseCommandArgs)('git commit -m "feat: complete visual testing"');
    node_assert_1.default.deepStrictEqual(args, ['git', 'commit', '-m', 'feat: complete visual testing']);
    const argsSimple = (0, agentController_1.parseCommandArgs)('ls -la src/controllers');
    node_assert_1.default.deepStrictEqual(argsSimple, ['ls', '-la', 'src/controllers']);
});
(0, node_test_1.default)('Visual Browser Integration & Interactive Human Testing Suite', async (t) => {
    // 1. Start a lightweight local HTTP server for real visual/browser interaction testing
    const server = http_1.default.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Replit Agent Interactive Playground</title>
        </head>
        <body>
          <h1>Visual Testing Product</h1>
          <form id="test-form" onsubmit="event.preventDefault(); console.log('Form Submit Successful!');">
            <label for="username">Username:</label>
            <input type="text" id="username" />
            <button type="submit" id="submit-btn">Submit Product</button>
          </form>
          <script>
            console.log('Interactive test started!');
            document.getElementById('submit-btn').addEventListener('click', () => {
              console.log('Button Click Handled!');
            });
          </script>
        </body>
      </html>
    `);
    });
    // Listen on a random port
    const port = await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve(address.port);
        });
    });
    const url = `http://127.0.0.1:${port}`;
    let browser = null;
    try {
        // 2. Launch headless google-chrome (reading from config or env variable if present)
        const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome';
        browser = await puppeteer_core_1.default.launch({
            executablePath: execPath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        const consoleLogs = [];
        page.on('console', (msg) => {
            consoleLogs.push(msg.text());
        });
        // 3. Test Navigation & Visual Screenshot
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        node_assert_1.default.strictEqual(title, 'Replit Agent Interactive Playground', 'Page title should match');
        // Confirm that console logs were successfully captured
        node_assert_1.default.ok(consoleLogs.includes('Interactive test started!'), 'Should capture load console logs');
        const screenshotNavPath = path_1.default.resolve(process.cwd(), 'test_screenshot_navigate.png');
        await page.screenshot({ path: screenshotNavPath });
        // Verify screenshot file exists on disk (A11y/Visual confirmation)
        const navScreenshotExists = await fs_1.promises.stat(screenshotNavPath).then(() => true).catch(() => false);
        node_assert_1.default.ok(navScreenshotExists, 'Visual screenshot file should exist on disk after navigation');
        // 4. Test Key-by-key Human-like Typing Input
        const inputSelector = '#username';
        await page.waitForSelector(inputSelector);
        await page.type(inputSelector, 'Jules Engineer', { delay: 50 });
        // Check text input value
        const textValue = await page.$eval(inputSelector, (el) => el.value);
        node_assert_1.default.strictEqual(textValue, 'Jules Engineer', 'Keyboard typed text should match target element value');
        const screenshotTypePath = path_1.default.resolve(process.cwd(), 'test_screenshot_type.png');
        await page.screenshot({ path: screenshotTypePath });
        const typeScreenshotExists = await fs_1.promises.stat(screenshotTypePath).then(() => true).catch(() => false);
        node_assert_1.default.ok(typeScreenshotExists, 'Visual screenshot file should exist on disk after keyboard input');
        // 5. Test Mouse/Human Click Simulation
        const btnSelector = '#submit-btn';
        await page.click(btnSelector);
        // Wait for action to register console message
        await new Promise(r => setTimeout(r, 200));
        // Confirm console logs capture the click
        node_assert_1.default.ok(consoleLogs.includes('Button Click Handled!'), 'Console logs should capture human-like button click');
        node_assert_1.default.ok(consoleLogs.includes('Form Submit Successful!'), 'Console logs should capture submit action');
        const screenshotClickPath = path_1.default.resolve(process.cwd(), 'test_screenshot_click.png');
        await page.screenshot({ path: screenshotClickPath });
        const clickScreenshotExists = await fs_1.promises.stat(screenshotClickPath).then(() => true).catch(() => false);
        node_assert_1.default.ok(clickScreenshotExists, 'Visual screenshot file should exist on disk after button click');
        // Clean up test screenshots
        await fs_1.promises.unlink(screenshotNavPath).catch(() => { });
        await fs_1.promises.unlink(screenshotTypePath).catch(() => { });
        await fs_1.promises.unlink(screenshotClickPath).catch(() => { });
    }
    finally {
        // Delimiters properly finalized and closed as requested
        if (browser) {
            await browser.close().catch(() => { });
        }
        server.close();
    }
});
