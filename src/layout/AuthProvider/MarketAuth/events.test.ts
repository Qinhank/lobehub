import { afterEach, describe, expect, it, vi } from 'vitest';

import { marketAuthEvents } from './events';

describe('marketAuthEvents', () => {
  const unsubscribers: Array<() => void> = [];

  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) {
      unsubscribe();
    }
    vi.restoreAllMocks();
  });

  it('resolves true when a listener recovers authorization', async () => {
    const listener = vi.fn().mockResolvedValue(true);
    unsubscribers.push(marketAuthEvents.on('market-unauthorized', listener));

    await expect(
      marketAuthEvents.requestRecovery({ path: 'market.execInSandbox', timestamp: 1000 }),
    ).resolves.toBe(true);

    expect(listener).toHaveBeenCalledWith({ path: 'market.execInSandbox', timestamp: 1000 });
  });

  it('dedupes concurrent recovery requests', async () => {
    let resolveRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      resolveRecovery = resolve;
    });
    const listener = vi.fn(async () => {
      await recoveryGate;
      return true;
    });
    unsubscribers.push(marketAuthEvents.on('market-unauthorized', listener));

    const first = marketAuthEvents.requestRecovery({
      path: 'market.execInSandbox',
      timestamp: 1000,
    });
    const second = marketAuthEvents.requestRecovery({
      path: 'market.exportAndUploadFile',
      timestamp: 1001,
    });

    expect(second).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    resolveRecovery();

    await expect(first).resolves.toBe(true);
  });
});
