import path from 'node:path';

import {
  type ISandboxService,
  type SandboxCallToolResult,
  type SandboxExportFileResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';
import { sha256 } from 'js-sha256';
import mime from 'mime';

import { toolsEnv } from '@/envs/tools';
import { FileS3 } from '@/server/modules/S3';
import { type FileService } from '@/server/services/file';

const log = debug('lobe-server:agent-infra-sandbox');

interface AgentInfraResponse<T> {
  data?: T;
  hint?: string;
  message?: string;
  success?: boolean;
}

interface AgentInfraSandboxContext {
  detail?: unknown;
  hint?: string;
  home_dir: string;
  message?: string;
  success?: boolean;
  version?: string;
  workspace?: string;
}

interface AgentInfraShellCommandResult {
  command: string;
  console?: unknown[];
  exit_code?: number;
  output?: string;
  session_id: string;
  status: 'completed' | 'hard_timeout' | 'no_change_timeout' | 'running' | 'terminated';
}

interface AgentInfraShellViewResult {
  command?: string;
  console?: unknown[];
  exit_code?: number;
  output: string;
  session_id: string;
  status: 'completed' | 'hard_timeout' | 'no_change_timeout' | 'running' | 'terminated';
}

interface AgentInfraCodeResult {
  code: string;
  exit_code?: number;
  outputs?: Array<Record<string, unknown>>;
  session_id?: string;
  status?: string;
  stderr?: string;
  stdout?: string;
  traceback?: string[];
}

interface AgentInfraFileInfo {
  extension?: string;
  is_directory?: boolean;
  modified_time?: string;
  name: string;
  path: string;
  permissions?: string;
  size?: number;
}

interface AgentInfraFileListResult {
  directory_count?: number;
  file_count?: number;
  files?: AgentInfraFileInfo[];
  path: string;
  total_count?: number;
}

interface AgentInfraFileReadResult {
  content: string;
  file: string;
}

interface AgentInfraFileWriteResult {
  bytes_written?: number;
  file: string;
}

interface AgentInfraGlobFileInfo {
  is_directory?: boolean;
  modified_time?: string;
  name: string;
  path: string;
  size?: number;
}

interface AgentInfraFileGlobResult {
  files?: AgentInfraGlobFileInfo[];
  path: string;
  pattern: string;
  total_count?: number;
  truncated?: boolean;
}

interface AgentInfraFileOperationError {
  error_type?: string;
  message: string;
  operation?: string;
  path?: string;
}

interface AgentInfraGrepMatch {
  context_after?: string[];
  context_before?: string[];
  file: string;
  line_content: string;
  line_number: number;
}

interface AgentInfraFileGrepResult {
  files_matched?: number;
  files_searched?: number;
  match_count?: number;
  matches?: AgentInfraGrepMatch[];
  path: string;
  pattern: string;
  truncated?: boolean;
}

interface AgentInfraFileFindResult {
  files?: string[];
  path: string;
}

interface AgentInfraSandboxServiceOptions {
  baseUrl: string;
  fileService: FileService;
  topicId: string;
  workspace?: string;
}

const TOOL_ALIASES: Record<string, string> = {
  editLocalFile: 'editFile',
  globLocalFiles: 'globFiles',
  listLocalFiles: 'listFiles',
  moveLocalFiles: 'moveFiles',
  readLocalFile: 'readFile',
  renameLocalFile: 'renameFile',
  searchLocalFiles: 'searchFiles',
  writeLocalFile: 'writeFile',
};

const countLines = (content: string) => {
  if (!content) return 0;
  return content.split('\n').length;
};

const buildUrl = (baseUrl: string, pathname: string) =>
  new URL(pathname.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();

const shellEscape = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const safeParseJson = <T>(value: string): T | undefined => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const stringifyOutputs = (outputs?: Array<Record<string, unknown>>) => {
  if (!outputs?.length) return '';

  return outputs
    .map((output) => {
      if (typeof output.text === 'string') return output.text;
      if (typeof output.content === 'string') return output.content;

      return JSON.stringify(output);
    })
    .join('\n');
};

export class AgentInfraSandboxService implements ISandboxService {
  private readonly baseUrl: string;
  private contextPromise?: Promise<AgentInfraSandboxContext>;
  private readonly fileService: FileService;
  private readonly topicId: string;
  private readonly workspaceOverride?: string;

  constructor(options: AgentInfraSandboxServiceOptions) {
    this.baseUrl = options.baseUrl;
    this.fileService = options.fileService;
    this.topicId = options.topicId;
    this.workspaceOverride = options.workspace;
  }

  async callTool(toolName: string, params: Record<string, any>): Promise<SandboxCallToolResult> {
    const normalizedToolName = TOOL_ALIASES[toolName] || toolName;
    log('Calling self-hosted sandbox tool: %s with params: %O', normalizedToolName, params);

    try {
      switch (normalizedToolName) {
        case 'editFile': {
          return await this.editFile(params);
        }
        case 'execScript': {
          return await this.runCommand({
            background: false,
            command: params.command,
            timeout: params.timeout,
          });
        }
        case 'executeCode': {
          return await this.executeCode(params);
        }
        case 'getCommandOutput': {
          return await this.getCommandOutput(params);
        }
        case 'globFiles': {
          return await this.globFiles(params);
        }
        case 'grepContent': {
          return await this.grepContent(params);
        }
        case 'killCommand': {
          return await this.killCommand(params);
        }
        case 'listFiles': {
          return await this.listFiles(params);
        }
        case 'moveFiles': {
          return await this.moveFiles(params);
        }
        case 'readFile': {
          return await this.readFile(params);
        }
        case 'renameFile': {
          return await this.renameFile(params);
        }
        case 'runCommand': {
          return await this.runCommand(params);
        }
        case 'searchFiles': {
          return await this.searchFiles(params);
        }
        case 'writeFile': {
          return await this.writeFile(params);
        }
        default: {
          return {
            error: { message: `Unsupported self-hosted sandbox tool: ${toolName}` },
            result: null,
            sessionExpiredAndRecreated: false,
            success: false,
          };
        }
      }
    } catch (error) {
      log('Self-hosted sandbox tool %s failed: %O', normalizedToolName, error);

      return {
        error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : undefined,
        },
        result: null,
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }
  }

  async exportAndUploadFile(path: string, filename: string): Promise<SandboxExportFileResult> {
    log('Exporting file from self-hosted sandbox: %s (topicId=%s)', path, this.topicId);

    try {
      const resolvedPath = await this.resolvePath(path);
      const fileData = await this.downloadFile(resolvedPath);
      const today = new Date().toISOString().split('T')[0];
      const key = `code-interpreter-exports/${today}/${this.topicId}/${filename}`;

      const s3 = new FileS3();
      const mimeType = fileData.contentType || mime.getType(filename) || 'application/octet-stream';

      await s3.uploadBuffer(key, fileData.buffer, mimeType);

      const fileHash = sha256(key + Date.now().toString());
      const { fileId, url } = await this.fileService.createFileRecord({
        fileHash,
        fileType: mimeType,
        name: filename,
        size: fileData.buffer.length,
        url: key,
      });

      return {
        fileId,
        filename,
        mimeType,
        size: fileData.buffer.length,
        success: true,
        url,
      };
    } catch (error) {
      return {
        error: { message: error instanceof Error ? error.message : String(error) },
        filename,
        success: false,
      };
    }
  }

  private async editFile(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const resolvedPath = await this.resolvePath(params.path);
    const before = await this.readFileContent(resolvedPath);
    const search = String(params.search ?? '');
    const replace = String(params.replace ?? '');

    if (!search) {
      return {
        error: { message: 'editFile requires a non-empty search string.' },
        result: null,
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }

    const replacements = params.all
      ? before.split(search).length - 1
      : before.includes(search)
        ? 1
        : 0;

    if (replacements === 0) {
      return {
        error: { message: `Search text not found in ${params.path}` },
        result: null,
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }

    const after = params.all ? before.split(search).join(replace) : before.replace(search, replace);

    await this.writeFileContent(resolvedPath, after);

    return {
      result: {
        diffText: undefined,
        linesAdded: Math.max(countLines(after) - countLines(before), 0),
        linesDeleted: Math.max(countLines(before) - countLines(after), 0),
        replacements,
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async ensureDirectory(dir: string) {
    if (!dir || dir === '.') return;

    await this.executeShellCommand(`mkdir -p ${shellEscape(dir)}`, { background: false });
  }

  private async executeCode(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const cwd = params.cwd ? await this.resolvePath(params.cwd) : await this.getWorkspaceRoot();
    const language = params.language || 'python';

    if (language === 'typescript') {
      return this.executeTypeScript(params.code, cwd, params.timeout);
    }

    if (language === 'javascript') {
      const response = await this.requestJson<AgentInfraCodeResult>('v1/nodejs/execute', {
        body: JSON.stringify({
          code: params.code,
          cwd,
          timeout: params.timeout,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (response.success === false) return this.failureFromResponse(response, 'executeCode');

      const result = response.data || ({} as AgentInfraCodeResult);
      return {
        result: {
          exitCode: result.exit_code,
          output: result.stdout || stringifyOutputs(result.outputs),
          sessionId: result.session_id,
          stderr: result.stderr || result.traceback?.join('\n'),
          stdout: result.stdout || stringifyOutputs(result.outputs),
        },
        sessionExpiredAndRecreated: false,
        success: true,
      };
    }

    const response = await this.requestJson<AgentInfraCodeResult>('v1/code/execute', {
      body: JSON.stringify({
        code: params.code,
        cwd,
        language: 'python',
        timeout: params.timeout,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'executeCode');

    const result = response.data || ({} as AgentInfraCodeResult);

    return {
      result: {
        exitCode: result.exit_code,
        output: result.stdout || stringifyOutputs(result.outputs),
        sessionId: result.session_id,
        stderr: result.stderr || result.traceback?.join('\n'),
        stdout: result.stdout || stringifyOutputs(result.outputs),
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async executeShellCommand(
    command: string,
    options?: { background?: boolean; cwd?: string; timeout?: number },
  ) {
    const cwd = options?.cwd || (await this.getWorkspaceRoot());

    return this.requestJson<AgentInfraShellCommandResult>('v1/shell/exec', {
      body: JSON.stringify({
        async_mode: options?.background || false,
        command,
        exec_dir: cwd,
        timeout: options?.timeout,
        truncate: false,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }

  private async executeTypeScript(
    code: string,
    cwd: string,
    timeout?: number,
  ): Promise<SandboxCallToolResult> {
    const tempDir = path.posix.join(await this.getWorkspaceRoot(), '.lobehub', 'tmp');
    const tempFile = path.posix.join(
      tempDir,
      `exec-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
    );

    await this.ensureDirectory(tempDir);
    await this.writeFileContent(tempFile, code);

    const command = [
      'npx --yes tsx',
      shellEscape(tempFile),
      '; status=$?',
      `rm -f ${shellEscape(tempFile)}`,
      '; exit $status',
    ].join(' ');

    const response = await this.executeShellCommand(command, {
      background: false,
      cwd,
      timeout,
    });

    if (response.success === false) return this.failureFromResponse(response, 'executeCode');

    const result = response.data || ({} as AgentInfraShellCommandResult);
    return {
      result: {
        exitCode: result.exit_code,
        output: result.output || '',
        sessionId: result.session_id,
        stderr: result.exit_code && result.exit_code !== 0 ? result.output || '' : '',
        stdout: result.output || '',
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private failureFromResponse(
    response: { hint?: string; message?: string },
    operation: string,
  ): SandboxCallToolResult {
    return {
      error: {
        message: response.message || response.hint || `${operation} failed`,
        name: operation,
      },
      result: null,
      sessionExpiredAndRecreated: false,
      success: false,
    };
  }

  private async getCommandOutput(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const response = await this.requestJson<AgentInfraShellViewResult>('v1/shell/view', {
      body: JSON.stringify({ id: params.commandId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'getCommandOutput');

    const result = response.data || ({} as AgentInfraShellViewResult);

    return {
      result: {
        error: undefined,
        newOutput: result.output || '',
        running: result.status === 'running',
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async getSandboxContext(): Promise<AgentInfraSandboxContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.fetchSandboxContext();
    }

    return this.contextPromise;
  }

  private async getWorkspaceRoot() {
    if (this.workspaceOverride) return this.workspaceOverride;

    const context = await this.getSandboxContext();
    return context.workspace || context.home_dir || '/workspace';
  }

  private async globFiles(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const response = await this.requestJson<AgentInfraFileGlobResult>('v1/file/glob', {
      body: JSON.stringify({
        include_hidden: true,
        path: await this.resolveDirectory(params.directory),
        pattern: params.pattern,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'globFiles');

    const files = (response.data?.files || []).map((file) => file.path);

    return {
      result: {
        files,
        totalCount: response.data?.total_count ?? files.length,
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async grepContent(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const response = await this.requestJson<AgentInfraFileGrepResult>('v1/file/grep', {
      body: JSON.stringify({
        include: params.filePattern ? [params.filePattern] : undefined,
        path: await this.resolveDirectory(params.directory),
        pattern: params.pattern,
        recursive: params.recursive ?? true,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'grepContent');

    const matches = (response.data?.matches || []).map(
      (match) => `${match.file}:${match.line_number}: ${match.line_content}`,
    );

    return {
      result: {
        matches,
        totalMatches: response.data?.match_count ?? matches.length,
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async killCommand(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const response = await this.requestJson<unknown>('v1/shell/kill', {
      body: JSON.stringify({ id: params.commandId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'killCommand');

    return {
      result: { error: undefined, success: true },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async listFiles(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const response = await this.requestJson<AgentInfraFileListResult>('v1/file/list', {
      body: JSON.stringify({
        include_permissions: true,
        include_size: true,
        path: await this.resolveDirectory(params.directoryPath),
        recursive: false,
        show_hidden: true,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'listFiles');

    const files = (response.data?.files || []).map((file) => ({
      extension: file.extension,
      isDirectory: !!file.is_directory,
      modifiedTime: file.modified_time,
      name: file.name,
      path: file.path,
      permissions: file.permissions,
      size: file.size,
    }));

    return {
      result: {
        files,
        totalCount: response.data?.total_count ?? files.length,
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async moveFiles(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const operations = Array.isArray(params.operations) ? params.operations : [];
    const results = await Promise.all(
      operations.map(async (operation: { destination: string; source: string }) => {
        const source = await this.resolvePath(operation.source);
        const destination = await this.resolvePath(operation.destination);
        const destinationDir = path.posix.dirname(destination);

        const response = await this.executeShellCommand(
          `mkdir -p ${shellEscape(destinationDir)} && mv ${shellEscape(source)} ${shellEscape(destination)}`,
          { background: false },
        );

        const success = response.success !== false && (response.data?.exit_code ?? 0) === 0;

        return {
          destination: operation.destination,
          error: success
            ? undefined
            : response.message || response.data?.output || 'Failed to move file',
          source: operation.source,
          success,
        };
      }),
    );

    return {
      result: {
        results,
        successCount: results.filter((item) => item.success).length,
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async readFile(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const resolvedPath = await this.resolvePath(params.path);
    const response = await this.requestJson<AgentInfraFileReadResult>('v1/file/read', {
      body: JSON.stringify({
        end_line: params.endLine,
        file: resolvedPath,
        start_line: params.startLine,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'readFile');

    const content = response.data?.content || '';

    return {
      result: {
        charCount: content.length,
        content,
        fileType: mime.getType(resolvedPath) || undefined,
        filename: path.posix.basename(resolvedPath),
        totalCharCount: content.length,
        totalLineCount: countLines(content),
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async readFileContent(file: string) {
    const response = await this.requestJson<AgentInfraFileReadResult>('v1/file/read', {
      body: JSON.stringify({ file }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) {
      throw new Error(response.message || response.hint || `Failed to read ${file}`);
    }

    return response.data?.content || '';
  }

  private async renameFile(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const oldPath = await this.resolvePath(params.oldPath);
    const newPath = path.posix.join(path.posix.dirname(oldPath), params.newName);
    const response = await this.executeShellCommand(
      `mv ${shellEscape(oldPath)} ${shellEscape(newPath)}`,
      { background: false },
    );

    const success = response.success !== false && (response.data?.exit_code ?? 0) === 0;

    if (!success) {
      return {
        error: {
          message: response.message || response.data?.output || 'Failed to rename file',
        },
        result: { error: response.data?.output || response.message, newPath, success: false },
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }

    return {
      result: { newPath, success: true },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async requestJson<T>(
    pathname: string,
    init: RequestInit,
  ): Promise<AgentInfraResponse<T>> {
    const response = await fetch(buildUrl(this.baseUrl, pathname), init);
    const rawText = await response.text();
    const payload = rawText ? (safeParseJson<AgentInfraResponse<T>>(rawText) ?? {}) : {};

    if (!response.ok) {
      throw new Error(
        payload.message || payload.hint || rawText || `Sandbox request failed: ${pathname}`,
      );
    }

    return payload;
  }

  private async resolveDirectory(directory?: string) {
    if (!directory) return this.getWorkspaceRoot();
    return this.resolvePath(directory);
  }

  private async resolvePath(inputPath: string) {
    const normalized = inputPath.trim();
    if (!normalized) return this.getWorkspaceRoot();
    if (normalized.startsWith('/')) return path.posix.normalize(normalized);

    return path.posix.resolve(await this.getWorkspaceRoot(), normalized);
  }

  private async runCommand(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const response = await this.executeShellCommand(params.command, {
      background: params.background || false,
      cwd: params.cwd ? await this.resolvePath(params.cwd) : undefined,
      timeout: params.timeout,
    });

    if (response.success === false) return this.failureFromResponse(response, 'runCommand');

    const result = response.data || ({} as AgentInfraShellCommandResult);

    return {
      result: {
        commandId: result.session_id,
        exitCode: result.exit_code,
        output: result.output || '',
        shell_id: result.session_id,
        status: result.status,
        stderr: undefined,
        stdout: result.output || '',
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async searchFiles(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const response = await this.requestJson<
      AgentInfraFileFindResult | AgentInfraFileGlobResult | AgentInfraFileOperationError
    >('v1/file/glob', {
      body: JSON.stringify({
        include_hidden: true,
        include_metadata: true,
        path: await this.resolveDirectory(params.directory),
        pattern: this.searchPatternFromParams(params),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) return this.failureFromResponse(response, 'searchFiles');

    const globResult = response.data as AgentInfraFileGlobResult | undefined;
    const dateAfter = params.modifiedAfter ? new Date(params.modifiedAfter) : undefined;
    const dateBefore = params.modifiedBefore ? new Date(params.modifiedBefore) : undefined;

    const results = (globResult?.files || [])
      .filter((file) => {
        if (!file.modified_time) return true;
        const modifiedTime = new Date(file.modified_time);
        if (dateAfter && modifiedTime < dateAfter) return false;
        if (dateBefore && modifiedTime > dateBefore) return false;
        return true;
      })
      .map((file) => ({
        isDirectory: !!file.is_directory,
        modifiedTime: file.modified_time,
        name: file.name,
        path: file.path,
        size: file.size,
      }));

    return {
      result: {
        results,
        totalCount: results.length,
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private searchPatternFromParams(params: Record<string, any>) {
    const keyword = params.keyword || '';
    const fileType = params.fileType
      ? params.fileType.startsWith('.')
        ? params.fileType
        : `.${params.fileType}`
      : '';

    if (!keyword && !fileType) return '**/*';
    if (!keyword) return `**/*${fileType}`;
    if (!fileType) return `**/*${keyword}*`;

    return `**/*${keyword}*${fileType}`;
  }

  private async fetchSandboxContext(): Promise<AgentInfraSandboxContext> {
    const response = await fetch(buildUrl(this.baseUrl, 'v1/sandbox'));

    if (!response.ok) {
      throw new Error(`Failed to fetch sandbox context: ${response.status}`);
    }

    return response.json() as Promise<AgentInfraSandboxContext>;
  }

  private async downloadFile(path: string) {
    const url = new URL(buildUrl(this.baseUrl, 'v1/file/download'));
    url.searchParams.set('path', path);

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to download sandbox file: ${path}`);
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || undefined,
    };
  }

  private async writeFile(params: Record<string, any>): Promise<SandboxCallToolResult> {
    const resolvedPath = await this.resolvePath(params.path);
    await this.writeFileContent(resolvedPath, params.content);

    return {
      result: {
        bytesWritten: Buffer.byteLength(params.content || '', 'utf8'),
        success: true,
      },
      sessionExpiredAndRecreated: false,
      success: true,
    };
  }

  private async writeFileContent(file: string, content: string) {
    await this.ensureDirectory(path.posix.dirname(file));

    const response = await this.requestJson<AgentInfraFileWriteResult>('v1/file/write', {
      body: JSON.stringify({
        content,
        file,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (response.success === false) {
      throw new Error(response.message || response.hint || `Failed to write ${file}`);
    }

    return response;
  }
}

export const isAgentInfraSandboxConfigured = () =>
  !!toolsEnv.SANDBOX_BASE_URL && (toolsEnv.SANDBOX_PROVIDER || 'agent-infra') === 'agent-infra';
