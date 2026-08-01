import test from 'node:test'
import assert from 'node:assert'
import path from 'path'
import http from 'http'
import { promises as fs } from 'fs'
import puppeteer from 'puppeteer-core'
import { listDirFiles, performWebSearch, execPromise } from './controllers/agentController'

test('listDirFiles utility', async () => {
  const files = await listDirFiles(path.resolve(__dirname, '../../backend/src'), true)
  assert.ok(files.length > 0, 'Should find files in backend/src')
  const hasServerTs = files.some(f => f.endsWith('server.ts'))
  assert.ok(hasServerTs, 'Should find server.ts in the listing')
})

test('performWebSearch utility', async () => {
  const output = await performWebSearch('TypeScript')
  assert.ok(output && typeof output === 'string', 'Should return a string output')
  assert.ok(output.includes('TypeScript') || output.includes('Results for'), 'Output should contain relevant search topics')
})

test('execPromise execution utility', async () => {
  const result = await execPromise('echo "Hello Agent"')
  assert.strictEqual(result.stdout.trim(), 'Hello Agent', 'Should correctly capture stdout of executed command')
})

test('Visual Browser Integration & Interactive Human Testing Suite', async (t) => {
  // 1. Start a lightweight local HTTP server for real visual/browser interaction testing
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
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
    `)
  })

  // Listen on a random port
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any
      resolve(address.port)
    })
  })

  const url = `http://127.0.0.1:${port}`

  let browser: any = null
  try {
    // 2. Launch headless google-chrome
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    })

    const page = await browser.newPage()
    const consoleLogs: string[] = []

    page.on('console', (msg) => {
      consoleLogs.push(msg.text())
    })

    // 3. Test Navigation & Visual Screenshot
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const title = await page.title()
    assert.strictEqual(title, 'Replit Agent Interactive Playground', 'Page title should match')

    // Confirm that console logs were successfully captured
    assert.ok(consoleLogs.includes('Interactive test started!'), 'Should capture load console logs')

    const screenshotNavPath = path.resolve(process.cwd(), 'test_screenshot_navigate.png')
    await page.screenshot({ path: screenshotNavPath })

    // Verify screenshot file exists on disk (A11y/Visual confirmation)
    const navScreenshotExists = await fs.stat(screenshotNavPath).then(() => true).catch(() => false)
    assert.ok(navScreenshotExists, 'Visual screenshot file should exist on disk after navigation')

    // 4. Test Key-by-key Human-like Typing Input
    const inputSelector = '#username'
    await page.waitForSelector(inputSelector)
    await page.type(inputSelector, 'Jules Engineer', { delay: 50 })

    // Check text input value
    const textValue = await page.$eval(inputSelector, (el: any) => el.value)
    assert.strictEqual(textValue, 'Jules Engineer', 'Keyboard typed text should match target element value')

    const screenshotTypePath = path.resolve(process.cwd(), 'test_screenshot_type.png')
    await page.screenshot({ path: screenshotTypePath })
    const typeScreenshotExists = await fs.stat(screenshotTypePath).then(() => true).catch(() => false)
    assert.ok(typeScreenshotExists, 'Visual screenshot file should exist on disk after keyboard input')

    // 5. Test Mouse/Human Click Simulation
    const btnSelector = '#submit-btn'
    await page.click(btnSelector)

    // Wait for action to register console message
    await new Promise(r => setTimeout(r, 200))

    // Confirm console logs capture the click
    assert.ok(consoleLogs.includes('Button Click Handled!'), 'Console logs should capture human-like button click')
    assert.ok(consoleLogs.includes('Form Submit Successful!'), 'Console logs should capture submit action')

    const screenshotClickPath = path.resolve(process.cwd(), 'test_screenshot_click.png')
    await page.screenshot({ path: screenshotClickPath })
    const clickScreenshotExists = await fs.stat(screenshotClickPath).then(() => true).catch(() => false)
    assert.ok(clickScreenshotExists, 'Visual screenshot file should exist on disk after button click')

    // Clean up test screenshots
    await fs.unlink(screenshotNavPath).catch(() => {})
    await fs.unlink(screenshotTypePath).catch(() => {})
    await fs.unlink(screenshotClickPath).catch(() => {})

  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
    server.close()
  }
})
