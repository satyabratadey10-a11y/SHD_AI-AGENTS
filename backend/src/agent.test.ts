import test from 'node:test'
import assert from 'node:assert'
import path from 'path'
import { promises as fs } from 'fs'
import { listDirFiles, performWebSearch, execPromise } from './controllers/agentController'

test('listDirFiles utility', async () => {
  // listDirFiles of the backend/src directory
  const files = await listDirFiles(path.resolve(__dirname, '../../backend/src'), true)
  assert.ok(files.length > 0, 'Should find files in backend/src')

  // Verify listDirFiles finds the server.ts file
  const hasServerTs = files.some(f => f.endsWith('server.ts'))
  assert.ok(hasServerTs, 'Should find server.ts in the listing')
})

test('performWebSearch utility', async () => {
  // Test search with a standard string, which should hit the DuckDuckGo HTML or simulated output
  const output = await performWebSearch('TypeScript')
  assert.ok(output && typeof output === 'string', 'Should return a string output')
  assert.ok(output.includes('TypeScript') || output.includes('Results for'), 'Output should contain relevant search topics')
})

test('execPromise execution utility', async () => {
  // Run a simple command like echo or pwd
  const result = await execPromise('echo "Hello Agent"')
  assert.strictEqual(result.stdout.trim(), 'Hello Agent', 'Should correctly capture stdout of executed command')
})
