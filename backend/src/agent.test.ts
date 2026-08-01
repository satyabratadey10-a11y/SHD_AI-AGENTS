import test from 'node:test'
import assert from 'node:assert'
import path from 'path'
import http from 'http'
import dns from 'dns'
import { promises as fs } from 'fs'
import puppeteer from 'puppeteer-core'
import {
  listDirFiles,
  performWebSearch,
  execPromise,
  isValidUrl,
  resolveInWorkspace,
  parseCommandArgs
} from './controllers/agentController'

test('resolveInWorkspace path validation and traversal prevention', () => {
  // Safe paths
  const safePath1 = resolveInWorkspace('src/server.ts')
  assert.ok(safePath1.endsWith('src/server.ts'))

  const safePath2 = resolveInWorkspace('./package.json')
  assert.ok(safePath2.endsWith('package.json'))

  // Directory traversal attempts (must throw)
  assert.throws(() => {
    resolveInWorkspace('../../../etc/passwd')
  }, /Directory traversal attempt detected/)

  assert.throws(() => {
    resolveInWorkspace('/absolute/outside/workspace')
  }, /Directory traversal attempt detected/)

  // Update: sibling-prefix path traversal escape test
  assert.throws(() => {
    resolveInWorkspace('../workspace-secrets')
  }, /Directory traversal attempt detected/)
})

test('listDirFiles utility', async () => {
  // Update: Pass __dirname directly as requested, while preserving assertions
  const files = await listDirFiles(__dirname, true)
  assert.ok(files.length > 0, 'Should find files recursively')
  const hasTestFile = files.some(f => f.endsWith('agent.test.ts') || f.endsWith('agent.test.js'))
  assert.ok(hasTestFile, 'Should find this test file in the listing')
})

test('performWebSearch utility with stubbed fetch (success)', async () => {
  const originalFetch = global.fetch

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
    } as any
  }

  try {
    const output = await performWebSearch('TypeScript')
    assert.ok(output.includes('Retrieval evidence snippet text.'), 'Parsed search output should contain stubbed snippet text')
    assert.ok(output.includes('https://example.com/topic'), 'Parsed search output should contain stubbed title')
  } finally {
    global.fetch = originalFetch
  }
})

test('performWebSearch utility (failure branch)', async () => {
  const originalFetch = global.fetch

  // Stub global.fetch to simulate a failure
  global.fetch = async (url) => {
    return {
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    } as any
  }

  try {
    const output = await performWebSearch('TypeScript')
    assert.ok(output.includes('Error: Web search could not be completed'), 'Failure branch should indicate web search could not be completed')
  } finally {
    global.fetch = originalFetch
  }
})

test('execPromise execution utility', async () => {
  const result = await execPromise('echo Hello Agent')
  assert.strictEqual(result.stdout.trim(), 'Hello Agent', 'Should capture stdout of echo Hello Agent command')
})

test('isValidUrl SSRF and DNS verification utility with mocked DNS', async () => {
  // Update: Avoid live DNS resolution by stubbing dns.promises.resolve4 and resolve6
  const originalResolve4 = dns.promises.resolve4
  const originalResolve6 = dns.promises.resolve6

  dns.promises.resolve4 = (async (hostname: string) => {
    if (hostname === 'example.com' || hostname === 'google.com') {
      return ['93.184.216.34']
    }
    if (hostname === 'bad-dns-rebind.com') {
      return ['127.0.0.1']
    }
    if (hostname === 'private-host.local') {
      return ['10.0.0.1']
    }
    throw new Error('DNS lookup failed')
  }) as any

  dns.promises.resolve6 = (async (hostname: string) => {
    return []
  }) as any

  try {
    // Test valid public endpoints (should pass)
    assert.ok(await isValidUrl('https://example.com'))
    assert.ok(await isValidUrl('http://google.com/search'))

    // Test local IP address ranges & loopbacks (must be blocked)
    assert.strictEqual(await isValidUrl('http://127.0.0.1:3000'), false)
    assert.strictEqual(await isValidUrl('http://localhost:8080'), false)
    assert.strictEqual(await isValidUrl('https://10.0.0.1'), false)
    assert.strictEqual(await isValidUrl('http://192.168.1.1'), false)
    assert.strictEqual(await isValidUrl('http://169.254.169.254'), false)

    // Test mocked malicious DNS rebinding attempt (must be blocked)
    assert.strictEqual(await isValidUrl('http://bad-dns-rebind.com:8080'), false)
    assert.strictEqual(await isValidUrl('http://private-host.local/docs'), false)
  } finally {
    dns.promises.resolve4 = originalResolve4
    dns.promises.resolve6 = originalResolve6
  }
})

test('parseCommandArgs shell command parser', () => {
  const args = parseCommandArgs('git commit -m "feat: complete visual testing"')
  assert.deepStrictEqual(args, ['git', 'commit', '-m', 'feat: complete visual testing'])

  const argsSimple = parseCommandArgs('ls -la src/controllers')
  assert.deepStrictEqual(argsSimple, ['ls', '-la', 'src/controllers'])
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
    // 2. Launch headless google-chrome (reading from config or env variable if present)
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
    browser = await puppeteer.launch({
      executablePath: execPath,
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
    // Delimiters properly finalized and closed as requested
    if (browser) {
      await browser.close().catch(() => {})
    }
    server.close()
  }
})
