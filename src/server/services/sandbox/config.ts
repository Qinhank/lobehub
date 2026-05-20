import { toolsEnv } from '@/envs/tools';

export type SandboxProvider = 'agent-infra' | 'market';

export const getSandboxProvider = (): SandboxProvider => {
  if (toolsEnv.SANDBOX_PROVIDER) return toolsEnv.SANDBOX_PROVIDER;
  if (toolsEnv.SANDBOX_BASE_URL) return 'agent-infra';

  return 'market';
};

export const isSandboxEnabled = (): boolean => {
  if (toolsEnv.DISABLE_CLOUD_SANDBOX) return false;

  const provider = getSandboxProvider();
  if (provider === 'agent-infra') {
    return !!toolsEnv.SANDBOX_BASE_URL;
  }

  return true;
};
