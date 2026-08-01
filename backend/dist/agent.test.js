"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const path_1 = __importDefault(require("path"));
const agentController_1 = require("./controllers/agentController");
(0, node_test_1.default)('listDirFiles utility', async () => {
    // listDirFiles of the backend/src directory
    const files = await (0, agentController_1.listDirFiles)(path_1.default.resolve(__dirname, '../../backend/src'), true);
    node_assert_1.default.ok(files.length > 0, 'Should find files in backend/src');
    // Verify listDirFiles finds the server.ts file
    const hasServerTs = files.some(f => f.endsWith('server.ts'));
    node_assert_1.default.ok(hasServerTs, 'Should find server.ts in the listing');
});
(0, node_test_1.default)('performWebSearch utility', async () => {
    // Test search with a standard string, which should hit the DuckDuckGo HTML or simulated output
    const output = await (0, agentController_1.performWebSearch)('TypeScript');
    node_assert_1.default.ok(output && typeof output === 'string', 'Should return a string output');
    node_assert_1.default.ok(output.includes('TypeScript') || output.includes('Results for'), 'Output should contain relevant search topics');
});
(0, node_test_1.default)('execPromise execution utility', async () => {
    // Run a simple command like echo or pwd
    const result = await (0, agentController_1.execPromise)('echo "Hello Agent"');
    node_assert_1.default.strictEqual(result.stdout.trim(), 'Hello Agent', 'Should correctly capture stdout of executed command');
});
