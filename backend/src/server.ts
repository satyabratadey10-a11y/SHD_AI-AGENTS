import express from 'express'
import http from 'http'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'path'
import { WebSocketServer } from 'ws'
import agentRouter from './routes/agentRoutes'
import { attachPtyToSocket } from './terminal'

// Initialize Express app
const app = express()
app.use(cors())
app.use(helmet())
app.use(express.json())
app.use(morgan('combined'))

// API routes – mount under /api
app.use('/api/agent', agentRouter)

// Serve static frontend files if needed (for cloud platforms that serve the bundle)
const frontendDist = path.resolve(__dirname, '../../frontend/dist')
app.use(express.static(frontendDist))
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'))
})

// Create HTTP server and attach a WebSocket server for the terminal
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('WebSocket client connected')
  attachPtyToSocket(ws)
})

const PORT = process.env.PORT || 8080
server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`)
})
