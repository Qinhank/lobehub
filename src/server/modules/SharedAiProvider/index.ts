import { TRPCError } from '@trpc/server';

import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

export const SHARED_AI_PROVIDER_ADMIN_EMAIL =
  '00000000-0000-0000-0000-000000000000@users.claw.local';

export interface SharedAiProviderAccess {
  isSharedProviderAdmin: boolean;
  sharedProviderUserId?: string;
}

const hasOwnProviderConfig = (provider: Awaited<ReturnType<AiProviderModel['findById']>>) => {
  if (!provider) return false;
  if (provider.source === 'custom') return true;

  return !!provider.keyVaults;
};

export const resolveSharedAiProviderAccess = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<SharedAiProviderAccess> => {
  const sharedProviderAdmin = await UserModel.findByEmail(db, SHARED_AI_PROVIDER_ADMIN_EMAIL);
  const sharedProviderUserId = sharedProviderAdmin?.id;

  return {
    isSharedProviderAdmin: !!sharedProviderUserId && sharedProviderUserId === userId,
    ...(sharedProviderUserId && { sharedProviderUserId }),
  };
};

export const assertCanMutateSharedAiProvider = async (
  db: LobeChatDatabase,
  userId: string,
  providerId: string,
  access: SharedAiProviderAccess,
) => {
  const { isSharedProviderAdmin, sharedProviderUserId } = access;
  if (!sharedProviderUserId || isSharedProviderAdmin) return;

  const userProviderModel = new AiProviderModel(db, userId);
  const userProvider = await userProviderModel.findById(providerId);
  if (hasOwnProviderConfig(userProvider)) return;

  const sharedProviderModel = new AiProviderModel(db, sharedProviderUserId);
  const sharedProvider = await sharedProviderModel.findById(providerId);
  if (!sharedProvider) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `Provider "${providerId}" is managed by the shared administrator`,
  });
};

export const assertCanMutateSharedAiProviders = async (
  db: LobeChatDatabase,
  userId: string,
  providerIds: string[],
  access: SharedAiProviderAccess,
) => {
  const uniqueProviderIds = [...new Set(providerIds)];

  for (const providerId of uniqueProviderIds) {
    await assertCanMutateSharedAiProvider(db, userId, providerId, access);
  }
};
