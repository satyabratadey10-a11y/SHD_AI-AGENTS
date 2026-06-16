import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<App />)

// Add WebSocket initialization code here
import ws from './wsConnection'
ws.connect()