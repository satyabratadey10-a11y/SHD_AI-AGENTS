import React, { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import TerminalContainer from './TerminalContainer'
import { FileExplorer, AIProviders } from './UIComponents'
import ws from '../wsConnection'

interface WorkspaceProps {}

const Workspace: React.FC<WorkspaceProps> = () => {
  const editorRef = useRef<any>(null)
  const chatMessageRef = useRef<HTMLTextAreaElement>(null)

  const sendToTerminal = (message: string) => {
    ws.send(message)
  }

  return (
    <div className="workspace-layout">
      <div className="sidebar">
        <FileExplorer />
        <AIProviders />
      </div>

      <div className="editor-zone">
        <div className="code-editor">
          <Editor
            theme="vs-dark"
            defaultLanguage="typescript"
            onMount={(editor) => {
              editorRef.current = editor
            }}
          />
        </div>
        <div className="chat-pane">
          <textarea ref={chatMessageRef} placeholder="Enter Agent command..."></textarea>
          <button onClick={() => {
            if (chatMessageRef.current) {
              sendToTerminal(chatMessageRef.current.value)
              chatMessageRef.current.value = ''
            }
          }}>Run</button>
        </div>
      </div>

      <TerminalContainer />
    </div>
  )
}

export default Workspace
