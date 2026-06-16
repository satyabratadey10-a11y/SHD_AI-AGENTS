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
  temperature?: float
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

  return config
}
