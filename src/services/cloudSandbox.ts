import { toolsClient } from '@/libs/trpc/client';
import {
  type CallToolResult,
  type ExecInSandboxInput,
  type ExportAndUploadFileInput,
  type ExportAndUploadFileResult,
} from '@/server/routers/tools/market';

const isMarketUnauthorizedError = (error: unknown): boolean => {
  const err = error as {
    data?: { code?: string; httpStatus?: number };
    message?: string;
  };
  const message = err.message?.toLowerCase() || '';

  return (
    err.data?.httpStatus === 401 ||
    err.data?.code === 'UNAUTHORIZED' ||
    message.includes('market authorization expired')
  );
};

class CloudSandboxService {
  private async retryAfterMarketAuth<T>(path: string, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (!isMarketUnauthorizedError(error)) {
        throw error;
      }

      const { marketAuthEvents } = await import('@/layout/AuthProvider/MarketAuth/events');
      const recovered = await marketAuthEvents.requestRecovery({
        path,
        timestamp: Date.now(),
      });

      if (!recovered) {
        throw error;
      }

      return request();
    }
  }

  /**
   * Call a cloud sandbox tool
   * @param toolName - The name of the tool to call (e.g., 'runCommand', 'writeFile')
   * @param params - The parameters for the tool
   * @param context - Session context containing topicId and optional userId for isolation
   */
  async callTool(
    toolName: string,
    params: Record<string, any>,
    context: { topicId: string; userId?: string },
  ): Promise<CallToolResult> {
    const input: ExecInSandboxInput = {
      params,
      toolName,
      topicId: context.topicId,
      userId: context.userId,
    };

    return this.retryAfterMarketAuth('market.execInSandbox', () =>
      toolsClient.market.execInSandbox.mutate(input),
    );
  }

  /**
   * Export a file from sandbox and upload to S3, then create a persistent file record
   * This is a single call that combines: getUploadUrl + callTool(exportFile) + createFileRecord
   * Returns a permanent /f/:id URL instead of a temporary pre-signed URL
   * @param path - The file path in the sandbox
   * @param filename - The name of the file to export
   * @param topicId - The topic ID for organizing files
   */
  async exportAndUploadFile(
    path: string,
    filename: string,
    topicId: string,
  ): Promise<ExportAndUploadFileResult> {
    const input: ExportAndUploadFileInput = {
      filename,
      path,
      topicId,
    };

    return this.retryAfterMarketAuth('market.exportAndUploadFile', () =>
      toolsClient.market.exportAndUploadFile.mutate(input),
    );
  }
}

export const cloudSandboxService = new CloudSandboxService();
