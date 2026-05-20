import { builtinSkills } from '@lobechat/builtin-skills';
import { type CommandResult, SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  type ExportFileResult,
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import type { SkillItem, SkillListItem, SkillResourceContent } from '@lobechat/types';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { UserModel } from '@/database/models/user';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { ServerSandboxService } from '@/server/services/sandbox';
import { SkillResourceService } from '@/server/services/skill/resource';
import { preprocessLhCommand } from '@/server/services/toolExecution/preprocessLhCommand';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skills-runtime');

class SkillServerRuntimeService implements SkillRuntimeService {
  private resourceService: SkillResourceService;
  private skillModel: AgentSkillModel;
  private fileService: FileService;
  private fileModel: FileModel;
  private sandboxService: ServerSandboxService;
  private topicId?: string;
  private userId: string;

  constructor(options: {
    fileModel: FileModel;
    fileService: FileService;
    resourceService: SkillResourceService;
    sandboxService: ServerSandboxService;
    skillModel: AgentSkillModel;
    topicId?: string;
    userId: string;
  }) {
    this.skillModel = options.skillModel;
    this.resourceService = options.resourceService;
    this.fileService = options.fileService;
    this.fileModel = options.fileModel;
    this.sandboxService = options.sandboxService;
    this.topicId = options.topicId;
    this.userId = options.userId;
  }

  findAll = (): Promise<{ data: SkillListItem[]; total: number }> => {
    return this.skillModel.findAll();
  };

  findById = (id: string): Promise<SkillItem | undefined> => {
    return this.skillModel.findById(id);
  };

  findByName = (name: string): Promise<SkillItem | undefined> => {
    return this.skillModel.findByName(name);
  };

  readResource = async (id: string, path: string): Promise<SkillResourceContent> => {
    const skill = await this.skillModel.findById(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (!skill.resources) throw new Error(`Skill has no resources: ${id}`);
    return this.resourceService.readResource(skill.resources, path);
  };

  runCommand = async (options: { command: string }): Promise<CommandResult> => {
    if (!this.topicId) {
      throw new Error('topicId is required for runCommand');
    }

    // Preprocess lh commands: rewrite to npx @lobehub/cli + inject auth env vars
    const lhResult = await preprocessLhCommand(options.command, this.userId);
    if (lhResult.error) {
      return { exitCode: 1, output: '', stderr: lhResult.error, success: false };
    }

    try {
      const response = await this.sandboxService.callTool('runCommand', {
        command: lhResult.command,
      });

      log('runCommand response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error running command: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  execScript = async (
    command: string,
    options: {
      config?: { description?: string; id?: string; name?: string };
      description: string;
      runInClient?: boolean;
    },
  ): Promise<CommandResult> => {
    const { config, description } = options;

    if (!this.topicId) {
      throw new Error('topicId is required for execScript');
    }

    try {
      // Look up skill zipUrl if config is provided (same logic as market.ts)
      const enhancedParams: any = {
        command,
        config,
        description,
      };

      if (config?.name) {
        const skill = await this.skillModel.findByName(config.name);

        // If skill not found, return error with available skills
        if (!skill) {
          const allSkills = await this.skillModel.findAll();
          const availableSkills = allSkills.data.map((s) => s.name).join(', ');

          const errorMessage = availableSkills
            ? `Skill "${config.name}" not found. Available skills: ${availableSkills}`
            : `Skill "${config.name}" not found. No skills available. Please import a skill first.`;

          log('Skill not found: %s. Available skills: %s', config.name, availableSkills);

          return {
            exitCode: 1,
            output: '',
            stderr: errorMessage,
            success: false,
          };
        }

        if (skill.zipFileHash) {
          const fileInfo = await this.fileModel.checkHash(skill.zipFileHash);

          if (fileInfo.isExist && fileInfo.url) {
            const fullUrl = await this.fileService.getFullFileUrl(fileInfo.url);
            if (fullUrl) {
              enhancedParams.zipUrl = fullUrl;
              log('Added zipUrl to execScript params for skill %s: %s', skill.name, fullUrl);
            }
          }
        }
      }

      const response = await this.sandboxService.callTool('execScript', enhancedParams);

      log('execScript response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error executing script: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  exportFile = async (path: string, filename: string): Promise<ExportFileResult> => {
    if (!this.topicId) {
      throw new Error('topicId is required for exportFile');
    }

    try {
      return await this.sandboxService.exportAndUploadFile(path, filename);
    } catch (error) {
      log('Error exporting file: %O', error);
      return {
        filename,
        success: false,
      };
    }
  };
}

/**
 * Skills Server Runtime
 * Per-request runtime (needs serverDB, userId, topicId)
 */
export const skillsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skills execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skills execution');
    }

    // Fetch market access token from user settings
    let marketAccessToken: string | undefined;
    try {
      const userModel = new UserModel(context.serverDB, context.userId);
      const userSettings = await userModel.getUserSettings();
      marketAccessToken = (userSettings?.market as any)?.accessToken;
      log(
        'Fetched market accessToken for user %s: %s',
        context.userId,
        marketAccessToken ? 'exists' : 'not found',
      );
    } catch (error) {
      log('Failed to fetch market accessToken for user %s: %O', context.userId, error);
    }

    const skillModel = new AgentSkillModel(context.serverDB, context.userId);
    const resourceService = new SkillResourceService(context.serverDB, context.userId);
    const marketService = new MarketService({
      accessToken: marketAccessToken,
      userInfo: { userId: context.userId },
    });
    const fileService = new FileService(context.serverDB, context.userId);
    const fileModel = new FileModel(context.serverDB, context.userId);
    const sandboxService = new ServerSandboxService({
      fileService,
      marketService,
      topicId: context.topicId || 'default',
      userId: context.userId,
    });

    const service = new SkillServerRuntimeService({
      fileModel,
      fileService,
      resourceService,
      sandboxService,
      skillModel,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new SkillsExecutionRuntime({
      builtinSkills: filterBuiltinSkills(builtinSkills),
      service,
    });
  },
  identifier: SkillsIdentifier,
};
