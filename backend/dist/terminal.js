"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachPtyToSocket = attachPtyToSocket;
const pty = __importStar(require("node-pty"));
const os_1 = __importDefault(require("os"));
const uuid_1 = require("uuid");
/**
 * Creates a pty process for a given WebSocket connection.
 * The pty runs the user's default shell (bash/sh) inside the container.
 * All data received from the client is written to the pty's stdin.
 * All pty output (stdout/stderr) is forwarded to the client.
 */
function attachPtyToSocket(ws) {
    // Choose a sensible shell based on OS
    const shell = os_1.default.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    // Create a pseudo‑terminal
    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: process.env
    });
    // Forward data from pty to the WebSocket client
    ptyProcess.onData(data => {
        if (ws.readyState === ws.OPEN) {
            ws.send(data);
        }
    });
    // Forward client input to the pty
    ws.on('message', (msg) => {
        // Accept string data only – binary frames are not used in this protocol.
        if (typeof msg === 'string') {
            ptyProcess.write(msg);
        }
    });
    ws.on('close', () => {
        ptyProcess.kill();
    });
    // Optional: send an initial prompt
    ws.send('\r\nConnected to pty - session ID: ' + (0, uuid_1.v4)() + '\r\n');
}
