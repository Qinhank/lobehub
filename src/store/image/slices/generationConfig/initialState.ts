import { type ModelParamsSchema, type RuntimeImageGenParams } from 'model-bank';
import { extractDefaultValues, ModelProvider } from 'model-bank';
import { gptImage2Schema } from 'model-bank/lobehub';

import { DEFAULT_IMAGE_CONFIG } from '@/const/settings';

export const DEFAULT_AI_IMAGE_PROVIDER = ModelProvider.OpenAI;
export const DEFAULT_AI_IMAGE_MODEL = 'gpt-image-2';

export interface GenerationConfigState {
  parameters: RuntimeImageGenParams;
  parametersSchema: ModelParamsSchema;

  provider: string;
  model: string;
  imageNum: number;

  isAspectRatioLocked: boolean;
  activeAspectRatio: string | null; // string - virtual ratio; null - native ratio

  /**
   * Marks whether the configuration has been initialized (including restoration from memory)
   */
  isInit: boolean;
}

export const DEFAULT_IMAGE_GENERATION_PARAMETERS: RuntimeImageGenParams =
  extractDefaultValues(gptImage2Schema);

export const initialGenerationConfigState: GenerationConfigState = {
  model: DEFAULT_AI_IMAGE_MODEL,
  provider: DEFAULT_AI_IMAGE_PROVIDER,
  imageNum: DEFAULT_IMAGE_CONFIG.defaultImageNum,
  parameters: DEFAULT_IMAGE_GENERATION_PARAMETERS,
  parametersSchema: gptImage2Schema,
  isAspectRatioLocked: false,
  activeAspectRatio: null,
  isInit: false,
};
