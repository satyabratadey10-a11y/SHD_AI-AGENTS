import React from 'react'
import Workspace from './components/Workspace'

// Simple dark theme wrapper mimicking Replit's UI
const App: React.FC = () => {
  return (
    <div className="app" style={{
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <header style={{ padding: '8px 16px', backgroundColor: '#2d2d2d', fontWeight: 'bold' }}>
        Cloud Development Environment (CDE)
      </header>
      <main style={{ flexGrow: 1, overflow: 'hidden' }}>
        <Workspace />
      </main>
    </div>
  )
}

export default App
