import { PrismaClient } from '@prisma/client'
import { OpenAI } from 'openai'
import { Anthropic } from '@anthropic-ai/sdk'

const prisma = new PrismaClient()

export enum ProviderType {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  GENERIC_REST = 'GENERIC_REST'
}

export interface AIProviderConfig {
  apiKey: string
  baseURL?: string
  type: ProviderType
  modelName: string
  maxTokens?: number
  temperature?: number
  liteModel?: string
  economyModel?: string
  powerModel?: string
  turboModel?: string
}

export async function createAIClient(providerId: string) {
  const provider = await prisma.aIProvider.findFirst({
    where: { id: providerId, isActive: true }
  })

  if (!provider) {
    throw new Error('Active AI Provider configuration not found')
  }

  // Assuming apiKey is stored directly or decrypted previously
  const apiKey = provider.apiKeyEncrypted 

  const config: AIProviderConfig = {
    apiKey: apiKey,
    baseURL: provider.baseURL ?? undefined,
    type: provider.type as ProviderType,
    modelName: provider.modelName,
    maxTokens: provider.maxTokens,
    temperature: provider.temperature,
    liteModel: provider.liteModel ?? undefined,
    economyModel: provider.economyModel ?? undefined,
    powerModel: provider.powerModel ?? undefined,
    turboModel: provider.turboModel ?? undefined
  }

  let client: any = null
  if (config.type === ProviderType.OPENAI) {
    client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
  } else if (config.type === ProviderType.ANTHROPIC) {
    client = new Anthropic({ apiKey: config.apiKey })
  } else {
    // Generic REST client - full OpenAI-compatible API caller
    client = {
      chat: {
        completions: {
          create: async (payload: { model?: string; messages: any[]; max_tokens?: number; temperature?: number }) => {
            const apiBase = config.baseURL || 'https://api.openai.com/v1'
            const endpoint = apiBase.endsWith('/') ? `${apiBase}chat/completions` : `${apiBase}/chat/completions`

            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}` // nosonar
              },
              body: JSON.stringify({
                model: payload.model || config.modelName,
                messages: payload.messages,
                max_tokens: payload.max_tokens || config.maxTokens,
                temperature: payload.temperature !== undefined ? payload.temperature : config.temperature
              })
            })

            if (!response.ok) {
              const errBody = await response.text().catch(() => '')
              throw new Error(`Generic REST API error (status ${response.status}): ${errBody}`)
            }

            const data = await response.json()
            return data
          }
        }
      }
    }
  }

  return {
    client,
    type: config.type,
    getConfig: () => config
  }
}
