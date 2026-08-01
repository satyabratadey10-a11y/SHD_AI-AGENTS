"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const ws_1 = require("ws");
const agentRoutes_1 = __importDefault(require("./routes/agentRoutes"));
const terminal_1 = require("./terminal");
// Initialize Express app
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use(express_1.default.json());
app.use((0, morgan_1.default)('combined'));
// API routes – mount under /api
app.use('/api/agent', agentRoutes_1.default);
// Serve static frontend files if needed (for cloud platforms that serve the bundle)
const frontendDist = path_1.default.resolve(__dirname, '../../frontend/dist');
app.use(express_1.default.static(frontendDist));
app.get('*', (req, res) => {
    res.sendFile(path_1.default.join(frontendDist, 'index.html'));
});
// Create HTTP server and attach a WebSocket server for the terminal
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    (0, terminal_1.attachPtyToSocket)(ws);
});
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
});
