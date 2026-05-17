import { type ProviderConfig } from '@lobechat/types';
import { type AiFullModelCard } from 'model-bank';
import { ModelProvider } from 'model-bank';
import * as AiModels from 'model-bank';

import { getLLMConfig } from '@/envs/llm';
import { resolveServerUrl } from '@/server/utils/resolveServerUrl';
import { extractEnabledModels, transformToAiModelList } from '@/utils/server/parseModels';

interface ProviderSpecificConfig {
  enabled?: boolean;
  enabledKey?: string;
  fetchOnClient?: boolean;
  modelListKey?: string;
  withDeploymentName?: boolean;
}

const getServerManagedKeyVaults = (provider: ModelProvider) => {
  if (provider !== ModelProvider.OpenAI) return;

  const baseURL = resolveServerUrl(process.env.OPENAI_PROXY_URL);
  if (!baseURL) return;

  return {
    apiKey: 'server-managed',
    baseURL,
  };
};

export const genServerAiProvidersConfig = async (
  specificConfig: Record<any, ProviderSpecificConfig>,
) => {
  const llmConfig = getLLMConfig() as Record<string, any>;

  // Process all providers concurrently
  const providerConfigs = await Promise.all(
    Object.values(ModelProvider).map(async (provider) => {
      const providerUpperCase = provider.toUpperCase();
      const aiModels = AiModels[provider] as AiFullModelCard[];

      if (!aiModels)
        throw new Error(
          `Provider [${provider}] not found in aiModels, please make sure you have exported the provider in the \`aiModels/index.ts\``,
        );

      const providerConfig = specificConfig[provider as keyof typeof specificConfig] || {};
      const modelString =
        process.env[providerConfig.modelListKey ?? `${providerUpperCase}_MODEL_LIST`];
      const serverManagedKeyVaults = getServerManagedKeyVaults(provider);

      // Process extractEnabledModels and transformToAiModelList concurrently
      const [enabledModels, serverModelLists] = await Promise.all([
        extractEnabledModels(provider, modelString, providerConfig.withDeploymentName || false),
        transformToAiModelList({
          defaultModels: aiModels || [],
          modelString,
          providerId: provider,
          withDeploymentName: providerConfig.withDeploymentName || false,
        }),
      ]);

      return {
        config: {
          enabled:
            typeof providerConfig.enabled !== 'undefined'
              ? providerConfig.enabled
              : llmConfig[providerConfig.enabledKey || `ENABLED_${providerUpperCase}`],
          enabledModels,
          serverModelLists,
          ...(providerConfig.fetchOnClient !== undefined && {
            fetchOnClient: providerConfig.fetchOnClient,
          }),
          ...(serverManagedKeyVaults && {
            fetchOnClient: false,
            keyVaults: serverManagedKeyVaults,
          }),
        },
        provider,
      };
    }),
  );

  // Convert the results to an object
  const config = {} as Record<string, ProviderConfig>;
  for (const { provider, config: providerConfig } of providerConfigs) {
    config[provider] = providerConfig;
  }

  return config;
};
