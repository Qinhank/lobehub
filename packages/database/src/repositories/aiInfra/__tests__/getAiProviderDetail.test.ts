import type { AiProviderDetailItem } from '@lobechat/types';
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
  describe('getAiProviderDetail', () => {
    it('should merge provider config with user settings', async () => {
      const providerId = 'openai';
      const mockProviderDetail = {
        id: providerId,
        customSetting: 'test',
      } as unknown as AiProviderDetailItem;

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue(mockProviderDetail);

      const result = await repo.getAiProviderDetail(providerId);

      expect(result).toMatchObject({
        id: providerId,
        customSetting: 'test',
        enabled: true, // from mockProviderConfigs
      });
    });

    it('should merge provider configs correctly', async () => {
      const mockProviderDetail = {
        enabled: true,
        id: 'openai',
        keyVaults: { apiKey: 'test-key' },
        name: 'Custom OpenAI',
        settings: {},
        source: 'builtin' as const,
      };

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue(mockProviderDetail);

      const result = await repo.getAiProviderDetail('openai');

      expect(result).toEqual({
        enabled: true,
        id: 'openai',
        keyVaults: { apiKey: 'test-key' },
        name: 'Custom OpenAI',
        settings: {},
        source: 'builtin',
      });
    });

    it('should return shared provider detail without shared key vaults', async () => {
      repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs, {
        sharedProviderUserId: 'shared-admin-id',
      });

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue(undefined);
      vi.spyOn((repo as any).sharedAiProviderModel, 'getAiProviderById').mockResolvedValue({
        enabled: true,
        fetchOnClient: true,
        id: 'shared-custom',
        keyVaults: { apiKey: 'shared-secret' },
        name: 'Shared Custom',
        settings: { sdkType: 'openai' },
        source: 'custom',
      });

      const result = await repo.getAiProviderDetail('shared-custom');

      expect(result).toMatchObject({
        enabled: true,
        fetchOnClient: false,
        id: 'shared-custom',
        keyVaults: {},
        name: 'Shared Custom',
        settings: { sdkType: 'openai' },
        source: 'custom',
      });
    });

    it('should keep shared metadata when user provider row has no key vaults', async () => {
      repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs, {
        sharedProviderUserId: 'shared-admin-id',
      });

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue({
        enabled: false,
        fetchOnClient: true,
        id: 'shared-custom',
        keyVaults: {},
        settings: {},
        source: 'custom',
      } as AiProviderDetailItem);
      vi.spyOn((repo as any).sharedAiProviderModel, 'getAiProviderById').mockResolvedValue({
        enabled: true,
        fetchOnClient: true,
        id: 'shared-custom',
        keyVaults: { apiKey: 'shared-secret' },
        name: 'Shared Custom',
        settings: { sdkType: 'openai' },
        source: 'custom',
      });

      const result = await repo.getAiProviderDetail('shared-custom');

      expect(result).toMatchObject({
        enabled: false,
        fetchOnClient: false,
        id: 'shared-custom',
        keyVaults: {},
        name: 'Shared Custom',
        settings: { sdkType: 'openai' },
        source: 'custom',
      });
    });

    it('should use user key vaults without exposing shared key vaults', async () => {
      repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs, {
        sharedProviderUserId: 'shared-admin-id',
      });

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue({
        enabled: true,
        fetchOnClient: true,
        id: 'shared-custom',
        keyVaults: { apiKey: 'user-secret' },
        settings: {},
        source: 'custom',
      } as AiProviderDetailItem);
      vi.spyOn((repo as any).sharedAiProviderModel, 'getAiProviderById').mockResolvedValue({
        enabled: true,
        fetchOnClient: false,
        id: 'shared-custom',
        keyVaults: {
          apiKey: 'shared-secret',
          baseURL: 'https://shared.example.com',
        },
        name: 'Shared Custom',
        settings: { sdkType: 'openai' },
        source: 'custom',
      });

      const result = await repo.getAiProviderDetail('shared-custom');

      expect(result).toMatchObject({
        fetchOnClient: true,
        keyVaults: { apiKey: 'user-secret' },
        name: 'Shared Custom',
        settings: { sdkType: 'openai' },
      });
      expect(result?.keyVaults).not.toHaveProperty('baseURL');
    });
  });
});
