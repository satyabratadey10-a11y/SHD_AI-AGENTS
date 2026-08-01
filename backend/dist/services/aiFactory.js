"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderType = void 0;
exports.createAIClient = createAIClient;
const client_1 = require("@prisma/client");
const openai_1 = require("openai");
const sdk_1 = require("@anthropic-ai/sdk");
const prisma = new client_1.PrismaClient();
var ProviderType;
(function (ProviderType) {
    ProviderType["OPENAI"] = "OPENAI";
    ProviderType["ANTHROPIC"] = "ANTHROPIC";
    ProviderType["GENERIC_REST"] = "GENERIC_REST";
})(ProviderType || (exports.ProviderType = ProviderType = {}));
async function createAIClient(providerId) {
    const provider = await prisma.aIProvider.findFirst({
        where: { id: providerId, isActive: true }
    });
    if (!provider) {
        throw new Error('Active AI Provider configuration not found');
    }
    // Assuming apiKey is stored directly or decrypted previously
    const apiKey = provider.apiKeyEncrypted;
    const config = {
        apiKey: apiKey,
        baseURL: provider.baseURL ?? undefined,
        type: provider.type,
        modelName: provider.modelName,
        maxTokens: provider.maxTokens,
        temperature: provider.temperature,
        liteModel: provider.liteModel ?? undefined,
        economyModel: provider.economyModel ?? undefined,
        powerModel: provider.powerModel ?? undefined,
        turboModel: provider.turboModel ?? undefined
    };
    let client = null;
    if (config.type === ProviderType.OPENAI) {
        client = new openai_1.OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    }
    else if (config.type === ProviderType.ANTHROPIC) {
        client = new sdk_1.Anthropic({ apiKey: config.apiKey });
    }
    else {
        // Generic REST client mock
        client = {
            chat: async (payload) => {
                return {
                    choices: [{ message: { content: JSON.stringify({ actions: [] }) } }]
                };
            }
        };
    }
    return {
        client,
        type: config.type,
        getConfig: () => config
    };
}
