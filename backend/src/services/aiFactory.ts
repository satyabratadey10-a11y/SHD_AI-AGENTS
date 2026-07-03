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
    // Generic REST client mock
    client = {
      chat: async (payload: any) => {
        return {
          choices: [{ message: { content: JSON.stringify({ actions: [] }) } }]
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

