import * as pty from 'node-pty'
import type { WebSocket } from 'ws'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'

/**
 * Creates a pty process for a given WebSocket connection.
 * The pty runs the user's default shell (bash/sh) inside the container.
 * All data received from the client is written to the pty's stdin.
 * All pty output (stdout/stderr) is forwarded to the client.
 */
export function attachPtyToSocket(ws: WebSocket) {
  // Choose a sensible shell based on OS
  const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

  // Create a pseudo‑terminal
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env: process.env
  })

  // Forward data from pty to the WebSocket client
  ptyProcess.on('data', data => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data)
    }
  })

  // Forward client input to the pty
  ws.on('message', (msg: string) => {
    // Accept string data only – binary frames are not used in this protocol.
    if (typeof msg === 'string') {
      ptyProcess.write(msg)
    }
  })

  ws.on('close', () => {
    ptyProcess.kill()
  })

  // Optional: send an initial prompt
  ws.send('\r\nConnected to pty - session ID: ' + uuidv4() + '\r\n')
}
