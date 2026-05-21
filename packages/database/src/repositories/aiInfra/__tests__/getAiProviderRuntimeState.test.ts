import type { AiProviderRuntimeConfig, EnabledProvider } from '@lobechat/types';
import type { EnabledAiModel } from 'model-bank';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

const userId = 'test-user-id';
const mockProviderConfigs = {
  openai: { enabled: true },
  anthropic: { enabled: false },
};

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs);
});

describe('AiInfraRepos', () => {
  describe('getAiProviderRuntimeState', () => {
    it('should return complete runtime state', async () => {
      const mockRuntimeConfig = {
        openai: { apiKey: 'test-key' },
      } as unknown as Record<string, AiProviderRuntimeConfig>;
      const mockEnabledProviders = [{ id: 'openai', name: 'OpenAI' }] as EnabledProvider[];
      const mockEnabledModels = [
        { id: 'gpt-4', providerId: 'openai', enabled: true },
      ] as EnabledAiModel[];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue(
        mockRuntimeConfig,
      );
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue(mockEnabledProviders);
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue(mockEnabledModels);

      const result = await repo.getAiProviderRuntimeState();

      expect(result).toMatchObject({
        enabledAiProviders: mockEnabledProviders,
        enabledAiModels: mockEnabledModels,
        runtimeConfig: expect.any(Object),
      });
    });

    it('should return provider runtime state', async () => {
      const mockRuntimeConfig = {
        openai: {
          apiKey: 'test-key',
        },
      } as unknown as Record<string, AiProviderRuntimeConfig>;

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue(
        mockRuntimeConfig,
      );

      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' },
      ]);

      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          abilities: {},
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
          type: 'chat',
        },
      ]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result).toEqual({
        enabledAiModels: [
          expect.objectContaining({
            enabled: true,
            id: 'gpt-4',
            providerId: 'openai',
          }),
        ],
        enabledAiProviders: [{ id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' }],
        enabledChatAiProviders: [
          { id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' },
        ],
        enabledImageAiProviders: [],
        enabledVideoAiProviders: [],
        runtimeConfig: {
          openai: {
            apiKey: 'test-key',
            enabled: true,
          },
        },
      });
    });

    it('should merge server-managed provider config into runtime state', async () => {
      repo = new AiInfraRepos(serverDB, userId, {
        openai: {
          config: { enableResponseApi: false },
          enabled: true,
          keyVaults: {
            apiKey: 'server-managed',
            baseURL: 'https://chat.example.com/sub2api',
          },
        },
      });

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue({});
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' },
      ]);
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          abilities: {},
          enabled: true,
          id: 'gpt5.5',
          providerId: 'openai',
          type: 'chat',
        },
      ]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result.runtimeConfig.openai).toMatchObject({
        config: { enableResponseApi: false },
        keyVaults: {
          apiKey: 'server-managed',
          baseURL: 'https://chat.example.com/sub2api',
        },
      });
    });

    it('should let server-managed provider config override stale user runtime config', async () => {
      repo = new AiInfraRepos(serverDB, userId, {
        openai: {
          config: { enableResponseApi: false },
          enabled: true,
          keyVaults: {
            apiKey: 'server-managed',
            baseURL: 'https://chat.example.com/sub2api',
          },
        },
      });

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue({
        openai: {
          config: { enableResponseApi: true },
          keyVaults: {
            apiKey: 'user-key',
            baseURL: 'https://api.openai.com/v1',
          },
          settings: {},
        },
      } as any);
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' },
      ]);
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          abilities: {},
          enabled: true,
          id: 'gpt5.5',
          providerId: 'openai',
          type: 'chat',
        },
      ]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result.runtimeConfig.openai).toMatchObject({
        config: { enableResponseApi: false },
        keyVaults: {
          apiKey: 'server-managed',
          baseURL: 'https://chat.example.com/sub2api',
        },
      });
    });

    it('should return provider runtime state with enabledImageAiProviders', async () => {
      const mockRuntimeConfig = {
        fal: {
          apiKey: 'test-fal-key',
        },
        openai: {
          apiKey: 'test-openai-key',
        },
      } as unknown as Record<string, AiProviderRuntimeConfig>;

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue(
        mockRuntimeConfig,
      );

      // Mock providers including fal for image generation
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'openai', logo: 'openai-logo', name: 'OpenAI', source: 'builtin' },
        { id: 'fal', logo: 'fal-logo', name: 'Fal', source: 'builtin' },
      ]);

      // Mock models including image models from fal
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          abilities: {},
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'flux/schnell',
          providerId: 'fal',
          type: 'image',
        },
        {
          abilities: {},
          enabled: true,
          id: 'flux-kontext/dev',
          providerId: 'fal',
          type: 'image',
        },
      ]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result).toEqual({
        enabledAiModels: [
          expect.objectContaining({
            enabled: true,
            id: 'gpt-4',
            providerId: 'openai',
            type: 'chat',
          }),
          expect.objectContaining({
            enabled: true,
            id: 'flux/schnell',
            providerId: 'fal',
            type: 'image',
          }),
          expect.objectContaining({
            enabled: true,
            id: 'flux-kontext/dev',
            providerId: 'fal',
            type: 'image',
          }),
        ],
        enabledAiProviders: [
          { id: 'openai', logo: 'openai-logo', name: 'OpenAI', source: 'builtin' },
          { id: 'fal', logo: 'fal-logo', name: 'Fal', source: 'builtin' },
        ],
        enabledChatAiProviders: [
          { id: 'openai', logo: 'openai-logo', name: 'OpenAI', source: 'builtin' },
        ],
        enabledImageAiProviders: [
          expect.objectContaining({
            id: 'fal',
            name: 'Fal',
          }),
        ],
        enabledVideoAiProviders: [],
        runtimeConfig: {
          fal: {
            apiKey: 'test-fal-key',
            enabled: undefined,
          },
          openai: {
            apiKey: 'test-openai-key',
            enabled: true,
          },
        },
      });
    });

    it('should strip shared provider key vaults from frontend runtime state', async () => {
      repo = new AiInfraRepos(serverDB, userId, {}, { sharedProviderUserId: 'shared-admin-id' });

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue({});
      vi.spyOn((repo as any).sharedAiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue({
        'shared-custom': {
          config: {},
          fetchOnClient: true,
          keyVaults: {
            apiKey: 'shared-secret',
            baseURL: 'https://shared.example.com',
          },
          settings: { sdkType: 'openai' },
        },
      } as any);
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'shared-custom', name: 'Shared Custom', source: 'custom' },
      ]);
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          enabled: true,
          id: 'shared-model',
          providerId: 'shared-custom',
          type: 'chat',
        },
      ] as EnabledAiModel[]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result.runtimeConfig['shared-custom']).toMatchObject({
        fetchOnClient: false,
        keyVaults: {},
        settings: { sdkType: 'openai' },
      });
    });

    it('should keep user key vaults isolated when merging shared runtime settings', async () => {
      repo = new AiInfraRepos(serverDB, userId, {}, { sharedProviderUserId: 'shared-admin-id' });

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue({
        'shared-custom': {
          config: {},
          fetchOnClient: true,
          keyVaults: {
            apiKey: 'user-secret',
          },
          settings: {},
        },
      } as any);
      vi.spyOn((repo as any).sharedAiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue({
        'shared-custom': {
          config: {},
          fetchOnClient: false,
          keyVaults: {
            apiKey: 'shared-secret',
            baseURL: 'https://shared.example.com',
          },
          settings: { sdkType: 'openai' },
        },
      } as any);
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'shared-custom', name: 'Shared Custom', source: 'custom' },
      ]);
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          enabled: true,
          id: 'shared-model',
          providerId: 'shared-custom',
          type: 'chat',
        },
      ] as EnabledAiModel[]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result.runtimeConfig['shared-custom']).toMatchObject({
        fetchOnClient: true,
        keyVaults: {
          apiKey: 'user-secret',
        },
        settings: { sdkType: 'openai' },
      });
      expect(result.runtimeConfig['shared-custom'].keyVaults).not.toHaveProperty('baseURL');
    });
  });
});
