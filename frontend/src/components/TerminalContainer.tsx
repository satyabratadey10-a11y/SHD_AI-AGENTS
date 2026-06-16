import React, { useEffect, useRef, useState } from 'react'
import * as Terminal from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

interface TerminalContainerProps {
  wsUrl?: string
}

const TerminalContainer: React.FC<TerminalContainerProps> = ({
  wsUrl = 'ws://localhost:8080'
}) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal.Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // Initialize terminal
    const term = new Terminal.Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4'
      },
      fontFamily: 'monospace',
      fontSize: 14
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Open terminal in DOM
    if (terminalRef.current) {
      term.attachTo(terminalRef.current)
      fitAddon.fit()
    }

    // Connect WebSocket
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      term.writeln('Connected to backend shell.')
      term.write('$ ')
    }

    ws.onmessage = (event) => {
      // Stream stdout/stderr back to terminal
      term.write(event.data)
    }

    ws.onerror = (error) => {
      term.writeln('WebSocket error occurred.')
    }

    ws.onclose = () => {
      setConnected(false)
      term.writeln('Disconnected from backend.')
    }

    // Handle user input
    term.onKey(e => {
      const printable = !e.domEvent.altKey && !e.domEvent.altGraphKey && !e.domEvent.ctrlKey && !e.domEvent.metaKey
      if (printable) {
        ws.send(e.key)
      }
    })

    return () => {
      ws.close()
      term.dispose()
    }
  }, [wsUrl])

  const resize = () => {
    if (fitAddonRef.current) {
      fitAddonRef.current.fit()
    }
  }

  useEffect(() => {
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  })

  return (
    <div className="terminal-container">
      <div ref={terminalRef} className="xterm-wrapper" />
      <div className="status-bar">
        {connected ? 'Connected' : 'Disconnected'}
      </div>
    </div>
  )
}

export default TerminalContainer