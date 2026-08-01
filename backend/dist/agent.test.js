"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const fs_1 = require("fs");
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const agentController_1 = require("./controllers/agentController");
(0, node_test_1.default)('listDirFiles utility', async () => {
    const files = await (0, agentController_1.listDirFiles)(path_1.default.resolve(__dirname, '../../backend/src'), true);
    node_assert_1.default.ok(files.length > 0, 'Should find files in backend/src');
    const hasServerTs = files.some(f => f.endsWith('server.ts'));
    node_assert_1.default.ok(hasServerTs, 'Should find server.ts in the listing');
});
(0, node_test_1.default)('performWebSearch utility', async () => {
    const output = await (0, agentController_1.performWebSearch)('TypeScript');
    node_assert_1.default.ok(output && typeof output === 'string', 'Should return a string output');
    node_assert_1.default.ok(output.includes('TypeScript') || output.includes('Results for'), 'Output should contain relevant search topics');
});
(0, node_test_1.default)('execPromise execution utility', async () => {
    const result = await (0, agentController_1.execPromise)('echo "Hello Agent"');
    node_assert_1.default.strictEqual(result.stdout.trim(), 'Hello Agent', 'Should correctly capture stdout of executed command');
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
        // 2. Launch headless google-chrome
        browser = await puppeteer_core_1.default.launch({
            executablePath: '/usr/bin/google-chrome',
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
        if (browser) {
            await browser.close().catch(() => { });
        }
        server.close();
    }
});
