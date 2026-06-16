// AI Factory Service - Dynamically creates LLM adapters based on user registry
import { PrismaClient } from '@prisma/client'
import { OpenAI } from 'openai'
import { Anthropic } from '@anthropic-ai/sdk'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// Provider Types
export enum ProviderType {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GENERIC_REST = 'generic-rest',
  AZURE_OPENAI = 'azure-openai'
}

// Provider Config
export interface AIProviderConfig {
  baseURL: string
  apiKey: string
  type: ProviderType
  modelName: string
  maxTokens: number
  temperature?: number
  liteModel?: string
  economyModel?: string
  powerModel?: string
  turboModel?: string
}

// Factory Method - Creates client based on provider config
export async function createAIClient(providerId: string): Promise<{
  type: ProviderType,
  client: any,
  getConfig: () => AIProviderConfig
}> {
  const provider = await prisma.aIProvider.findUnique({
    where: { id: providerId },
    include: { user: true }
  })

  if (!provider) {
    throw new Error(`Provider with ID ${providerId} not found`)
  }

  const config: AIProviderConfig = {
    baseURL: provider.baseURL,
    type: provider.type as ProviderType,
    modelName: provider.modelName,
    maxTokens: provider.maxTokens,
    temperature: provider.temperature || 0.7,
    liteModel: provider.liteModel,
    economyModel: provider.economyModel,
    powerModel: provider.powerModel,
    turboModel: provider.turboModel
  }

  // Decrypt API key (AI key is encrypted at rest)
  const decryptedKey = await decryptKey(provider.apiKeyEncrypted)

  switch (config.type) {
    case ProviderType.OPENAI:
      return {
        type: ProviderType.OPENAI,
        client: new OpenAI({
          baseURL: provider.baseURL,
          apiKey: decryptedKey
        }),
        getConfig: () => config
      }

    case ProviderType.ANTHROPIC:
      return {
        type: ProviderType.ANTHROPIC,
        client: new Anthropic({
          baseURL: provider.baseURL,
          apiKey: decryptedKey
        }),
        getConfig: () => config
      }

    case ProviderType.GENERIC_REST:
      return {
        type: ProviderType.GENERIC_REST,
        client: {
          chat: (messages: any[]) => {
            // Generic REST adapter
            return fetch(provider.baseURL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messages,
                model: provider.modelName,
                max_tokens: provider.maxTokens,
                temperature: provider.temperature || 0.7
              })
            }).then(res => res.json())
          },
          embeddings: (text: string) => {
            return fetch(`${provider.baseURL}/embeddings`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: provider.modelName,
                prompt: text
              })
            }).then(res => res.json())
          }
        },
        getConfig: () => config
      }

    default:
      throw new Error(`Unsupported provider type: ${config.type}`)
  }
}

// Enhanced security: Decrypt keys (in production this would be more robust)
async function decryptKey(encrypted: string): Promise<string> {
  // In production, this would use proper key management
  // For now, we'll simulate decryption
  return encrypted.replace('ENCRYPTED:', '')
}