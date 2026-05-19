import { afterEach, describe, expect, it, vi } from 'vitest';

import { marketAuthEvents } from '@/layout/AuthProvider/MarketAuth/events';
import { toolsClient } from '@/libs/trpc/client';

import { cloudSandboxService } from './cloudSandbox';

vi.mock('@/libs/trpc/client', () => ({
  toolsClient: {
    market: {
      execInSandbox: {
        mutate: vi.fn(),
      },
      exportAndUploadFile: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('cloudSandboxService', () => {
  const unsubscribers: Array<() => void> = [];

  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) {
      unsubscribe();
    }
    vi.clearAllMocks();
  });

  it('waits for Market auth recovery and retries sandbox calls once', async () => {
    const unauthorizedError = {
      data: { code: 'UNAUTHORIZED', httpStatus: 401 },
      message: 'Market authorization expired',
    };
    const successResult = {
      result: { output: 'ok' },
      success: true,
    };
    const mutate = vi.mocked(toolsClient.market.execInSandbox.mutate);
    mutate.mockRejectedValueOnce(unauthorizedError).mockResolvedValueOnce(successResult);

    const recoveryListener = vi.fn().mockResolvedValue(true);
    unsubscribers.push(marketAuthEvents.on('market-unauthorized', recoveryListener));

    await expect(
      cloudSandboxService.callTool('runCommand', { command: 'echo ok' }, { topicId: 'topic-1' }),
    ).resolves.toEqual(successResult);

    expect(recoveryListener).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('does not retry when Market auth recovery fails', async () => {
    const unauthorizedError = {
      data: { code: 'UNAUTHORIZED', httpStatus: 401 },
      message: 'Market authorization expired',
    };
    const mutate = vi.mocked(toolsClient.market.execInSandbox.mutate);
    mutate.mockRejectedValueOnce(unauthorizedError);

    unsubscribers.push(
      marketAuthEvents.on('market-unauthorized', vi.fn().mockResolvedValue(false)),
    );

    await expect(
      cloudSandboxService.callTool('runCommand', { command: 'echo ok' }, { topicId: 'topic-1' }),
    ).rejects.toBe(unauthorizedError);

    expect(mutate).toHaveBeenCalledOnce();
  });
});
