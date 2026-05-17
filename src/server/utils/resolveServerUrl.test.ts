// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://public.example.com',
    INTERNAL_APP_URL: 'https://internal.example.com',
  },
}));

describe('resolveServerUrl', () => {
  it('resolves relative same-app URLs against INTERNAL_APP_URL', async () => {
    const { resolveServerUrl } = await import('./resolveServerUrl');

    expect(resolveServerUrl('/sub2api')).toBe('https://internal.example.com/sub2api');
  });

  it('rewrites stale localhost sub2api URLs to the configured same-app base URL', async () => {
    const { resolveServerUrl } = await import('./resolveServerUrl');

    expect(resolveServerUrl('http://localhost:3010/sub2api/responses')).toBe(
      'https://internal.example.com/sub2api/responses',
    );
  });

  it('keeps external absolute URLs unchanged', async () => {
    const { resolveServerUrl } = await import('./resolveServerUrl');

    expect(resolveServerUrl('https://proxy.example.com/v1')).toBe('https://proxy.example.com/v1');
  });
});
