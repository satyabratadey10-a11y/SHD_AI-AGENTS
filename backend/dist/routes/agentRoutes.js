"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const agentController_1 = require("../controllers/agentController");
const router = (0, express_1.Router)();
// POST /api/agent/run – runs the autonomous agent loop
router.post('/run', agentController_1.runAgent);
exports.default = router;
