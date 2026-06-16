import { Request, Response } from 'express'
import { createAIClient, ProviderType } from '../services/aiFactory'
import { exec } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

/**
 * Runs an autonomous agent loop.
 *
 * 1️⃣ Parse the incoming user prompt and execution mode.
 * 2️⃣ Resolve the appropriate AI provider based on the mode (lite/economy/power/turbo).
 * 3️⃣ Send the prompt to the LLM and receive a structured response.
 * 4️⃣ Execute the suggested actions (file writes, shell commands).
 * 5️⃣ If any step fails, feed the error back to the LLM for self‑correction and repeat.
 *
 * The LLM is expected to return a JSON payload with an `actions` array where each
 * action has a `type` field (`writeFile` | `runShell`) and the necessary data.
 * This contract is deliberately simple for the demo – a production system would
 * employ a more sophisticated DSL.
 */
export async function runAgent(req: Request, res: Response) {
  const { prompt, mode, userId } = req.body as {
    prompt: string
    mode: 'lite' | 'economy' | 'power' | 'turbo'
    userId: string
  }

  if (!prompt || !mode || !userId) {
    return res.status(400).json({ error: 'Missing prompt, mode or userId' })
  }

  try {
    const provider = await resolveProviderForMode(userId, mode)
    const { client, type, getConfig } = await createAIClient(provider.id)

    // Helper to send a prompt and receive a structured response.
    const askModel = async (history: string[]): Promise<any> => {
      const cfg = getConfig()
      const systemPrompt = `You are an autonomous coding assistant. Respond ONLY with valid JSON containing an "actions" array. Each action may be:
- { "type": "writeFile", "path": string, "content": string }
- { "type": "runShell", "command": string }
If you need additional clarification, ask a follow‑up question in the same JSON format under a "question" field.`

      const messages = [{ role: 'system', content: systemPrompt }]
        .concat(history.map(content => ({ role: 'assistant', content })))
        .concat({ role: 'user', content: prompt })

      // Dispatch to the correct SDK based on provider type
      if (type === ProviderType.OPENAI) {
        const response = await (client as any).chat.completions.create({
          model: cfg.modelName,
          messages,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature
        })
        return response.choices[0].message.content
      } else if (type === ProviderType.ANTHROPIC) {
        const response = await (client as any).messages.create({
          model: cfg.modelName,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
          messages
        })
        return response.content[0].text
      } else {
        // Generic REST – assume it follows OpenAI‑style payload
        const resp = await (client as any).chat({ messages, max_tokens: cfg.maxTokens })
        return resp.choices[0].message.content
      }
    }

    // Execution loop – capped to avoid infinite recursion.
    const MAX_ITERATIONS = 5
    let history: string[] = []
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const raw = await askModel(history)
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (e) {
        // If the model didn't return valid JSON, ask it to fix.
        history.push(`The previous response was not valid JSON: ${raw}`)
        continue
      }

      // If the model asks a clarifying question, break and return it.
      if (parsed.question) {
        return res.json({ question: parsed.question })
      }

      const actions = parsed.actions as Array<any>
      if (!actions || actions.length === 0) {
        return res.json({ result: 'No actions required.' })
      }

      let anyError = false
      for (const act of actions) {
        try {
          if (act.type === 'writeFile') {
            const absolutePath = path.resolve(act.path)
            await fs.mkdir(path.dirname(absolutePath), { recursive: true })
            await fs.writeFile(absolutePath, act.content, 'utf8')
          } else if (act.type === 'runShell') {
            await execPromise(act.command)
          } else {
            throw new Error(`Unsupported action type: ${act.type}`)
          }
        } catch (err: any) {
          anyError = true
          // Append error to history so the model can correct it.
          history.push(`Error executing ${act.type}: ${err.message}`)
        }
      }

      if (!anyError) {
        // Success – return the final state.
        return res.json({ success: true, actions })
      }
      // If there was an error, loop again and let the model attempt a fix.
    }

    // Exhausted iterations without success.
    return res.status(500).json({ error: 'Agent failed to converge after maximum retries.' })
  } catch (err: any) {
    console.error('Agent error:', err)
    return res.status(500).json({ error: err.message })
  }
}

/** Resolve the appropriate AIProvider record for a given user+mode */
async function resolveProviderForMode(userId: string, mode: string) {
  const Prisma = (await import('@prisma/client')).PrismaClient
  const prisma = new Prisma()
  const mapField = {
    lite: 'liteModel',
    economy: 'economyModel',
    power: 'powerModel',
    turbo: 'turboModel'
  }[mode]

  // Find a provider where the chosen model field is not null and is active.
  const whereFilter: any = { 
    userId, 
    isActive: true 
  };
  whereFilter[mapField] = { not: null };

  const provider = await prisma.aIProvider.findFirst({
    where: whereFilter,
    orderBy: { updatedAt: 'desc' }
  });


  if (!provider) throw new Error(`No active AI provider configured for mode ${mode}`)
  return provider
}

/** Promisified exec */
function execPromise(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message))
      resolve(stdout)
    })
  })
}
