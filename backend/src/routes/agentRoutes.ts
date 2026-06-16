import { Router } from 'express'
import { runAgent } from '../controllers/agentController'

const router = Router()

// POST /api/agent/run – runs the autonomous agent loop
router.post('/run', runAgent)

export default router
