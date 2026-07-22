import type { TaskProfileId } from '../domain';
import {
  buildMultipleAnglesInput,
  FAL_MULTIPLE_ANGLES_MODEL,
  type FalGeneratedImage,
} from './multipleAngles';

export const FAL_PRODUCT_SHOT_MODEL = 'fal-ai/bria/product-shot';
export const FAL_DIRECTIONAL_LIGHT_EDIT_MODEL = 'bria/fibo-edit/edit';
export const FAL_DIRECTIONAL_LIGHT_STRUCTURE_MODEL = 'bria/fibo-edit/edit/structured_instruction';
export const FAL_ERASER_MODEL = 'fal-ai/bria/eraser';
export const FAL_BACKGROUND_REMOVE_MODEL = 'fal-ai/bria/background/remove';
export const FAL_EXPAND_MODEL = 'fal-ai/bria/expand';
export const FAL_UPSCALE_MODEL = 'fal-ai/topaz/upscale/image';

export type FalToolRequest = {
  profileId: TaskProfileId;
  imageUrls: string[];
  prompt: string;
  ratio: string;
  outputCount: number;
  parameters: Record<string, unknown>;
  maskImageUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type FalInvocation = {
  modelId: string;
  input: Record<string, unknown>;
};

export type FalWorkflowPlan = {
  modelId: string;
  invocations: FalInvocation[];
  upscaleFactors?: number[];
  directionalLight?: {
    sourceImageUrl: string;
    outputCount: number;
  };
};

export type NormalizedFalResult = {
  images: FalGeneratedImage[];
  seed?: number;
};

const imageSizes: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '4:5': [1024, 1280],
  '3:4': [960, 1280],
  '4:3': [1280, 960],
  '16:9': [1280, 720],
  '9:16': [720, 1280],
};

const sceneDescriptions: Record<string, string> = {
  '日光展台': 'A premium cosmetics product displayed on a clean pedestal in soft natural daylight, realistic commercial product photography',
  '水面倒影': 'A premium cosmetics product above a subtle reflective water surface with clean controlled highlights, realistic commercial product photography',
  '纯净棚拍': 'A premium cosmetics product in a clean neutral studio with softbox lighting and a seamless background, realistic commercial product photography',
};

const placements = new Set([
  'upper_left',
  'upper_right',
  'bottom_left',
  'bottom_right',
  'right_center',
  'left_center',
  'upper_center',
  'bottom_center',
  'center_vertical',
  'center_horizontal',
]);

const lightDirections = new Set([
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
  'front',
  'back',
]);

const lightDirectionInstructions: Record<string, string> = {
  'top-left': 'from the upper-left front. Brighten the upper and left-facing surfaces and cast directional shadows toward the lower-right',
  top: 'from directly above. Brighten the top-facing surfaces and cast shadows directly below the subject',
  'top-right': 'from the upper-right front. Brighten the upper and right-facing surfaces and cast directional shadows toward the lower-left',
  right: 'from camera-right. Brighten the right-facing surfaces and cast directional shadows toward the left',
  'bottom-right': 'from below and camera-right. Brighten the lower-right edges and cast directional shadows upward toward the upper-left',
  bottom: 'from directly below. Brighten the lower surfaces with unmistakable underlighting and cast shadows upward behind the subject',
  'bottom-left': 'from below and camera-left. Brighten the lower-left edges and cast directional shadows upward toward the upper-right',
  left: 'from camera-left. Brighten the left-facing surfaces and cast directional shadows toward the right',
  front: 'from the camera axis in front. Brighten the front-facing surfaces and cast shadows behind the subject',
  back: 'from behind the subject. Create a strong rim and backlight silhouette while keeping the front face comparatively darker',
};

const expandAnchors = new Set([
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
]);

function requireSource(request: FalToolRequest): string {
  const source = request.imageUrls[0]?.trim();
  if (!source) throw new Error('任务至少需要一张输入图片');
  return source;
}

function requireImageSize(ratio: string): [number, number] {
  const size = imageSizes[ratio];
  if (!size) throw new Error(`不支持的画面比例：${ratio}`);
  return size;
}

function outputCount(request: FalToolRequest): number {
  if (!Number.isInteger(request.outputCount) || request.outputCount < 1 || request.outputCount > 4) {
    throw new Error('输出数量必须为 1 到 4 的整数');
  }
  return request.outputCount;
}

function numberParameter(
  parameters: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const value = parameters[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}必须在 ${min} 到 ${max} 之间`);
  }
  return value;
}

function appendPrompt(base: string, prompt: string): string {
  const supplement = prompt.trim();
  if (!supplement) return base;
  return `${base}. Additional direction: ${supplement}`;
}

function productShotPlan(request: FalToolRequest, blend: boolean): FalWorkflowPlan {
  const source = requireSource(request);
  const [width, height] = requireImageSize(request.ratio);
  const count = outputCount(request);
  const placementValue = request.parameters.productPlacement;
  const placement = typeof placementValue === 'string' && placements.has(placementValue)
    ? placementValue
    : 'bottom_center';
  const input: Record<string, unknown> = {
    image_url: source,
    optimize_description: true,
    num_results: count,
    fast: request.parameters.quality !== '精细',
    placement_type: 'manual_placement',
    shot_size: [width, height],
    manual_placement_selection: placement,
  };

  if (blend) {
    const reference = request.imageUrls[1]?.trim();
    if (!reference) throw new Error('融图任务必须选择目标场景图片');
    input.ref_image_url = reference;
  } else {
    const template = typeof request.parameters.sceneTemplate === 'string'
      ? request.parameters.sceneTemplate
      : '日光展台';
    input.scene_description = appendPrompt(
      sceneDescriptions[template] ?? sceneDescriptions['日光展台'],
      request.prompt,
    );
  }

  return {
    modelId: FAL_PRODUCT_SHOT_MODEL,
    invocations: [{ modelId: FAL_PRODUCT_SHOT_MODEL, input }],
  };
}

function lightPlan(request: FalToolRequest): FalWorkflowPlan {
  const source = requireSource(request);
  const count = outputCount(request);
  const directionValue = request.parameters.lightDirection;
  const direction = typeof directionValue === 'string' && lightDirections.has(directionValue)
    ? directionValue
    : 'front';
  const intensity = numberParameter(
    request.parameters,
    'lightIntensity',
    60,
    0,
    100,
    '光线强度',
  );
  const temperature = numberParameter(
    request.parameters,
    'lightTemperature',
    5200,
    2800,
    7500,
    '色温',
  );
  const smartMode = request.parameters.lightSmartMode === true;
  const rimLight = request.parameters.rimLight === true;
  const instruction = [
    `Only relight this exact product photograph with the dominant key light in the selected ${direction} direction, ${lightDirectionInstructions[direction]}.`,
    `Make the selected direction unmistakable at ${intensity}% intensity and ${temperature}K color temperature: the illuminated face and the cast-shadow direction must visibly prove where the light comes from.`,
    smartMode ? 'Balance fill exposure automatically, but keep the selected key light visibly dominant.' : 'Keep fill light restrained so the directional contrast remains clearly visible.',
    rimLight ? 'Add a restrained rim light around the product silhouette without weakening the main directional shadow.' : '',
    request.prompt.trim() ? `Additional art direction: ${request.prompt.trim()}.` : '',
    'Preserve every product contour, existing text, logo, colors, material, reflection, prop, background, composition, camera angle, crop, object position, and object count.',
    'Do not add, remove, rewrite, or invent any text, logo, label, object, decoration, or surface feature. If an area is blank in the source, it must stay blank.',
    'The only allowed visual change is physically coherent illumination, highlight, and shadow.',
  ].filter(Boolean).join(' ');

  return {
    modelId: FAL_DIRECTIONAL_LIGHT_EDIT_MODEL,
    invocations: [{
      modelId: FAL_DIRECTIONAL_LIGHT_STRUCTURE_MODEL,
      input: {
        image_url: source,
        instruction,
        seed: 5555,
      },
    }],
    directionalLight: {
      sourceImageUrl: source,
      outputCount: count,
    },
  };
}

export function buildDirectionalLightInvocations(
  plan: FalWorkflowPlan,
  structuredInstruction: Record<string, unknown>,
): FalInvocation[] {
  const light = plan.directionalLight;
  if (!light?.sourceImageUrl) throw new Error('定向光源图已失效，请重试任务');
  if (!structuredInstruction || typeof structuredInstruction !== 'object') {
    throw new Error('定向光结构解析未生成可用结果');
  }

  return Array.from({ length: light.outputCount }, (_, index) => ({
    modelId: FAL_DIRECTIONAL_LIGHT_EDIT_MODEL,
    input: {
      image_url: light.sourceImageUrl,
      structured_instruction: structuredInstruction,
      seed: 5555 + index,
      steps_num: 36,
      guidance_scale: 5,
      negative_prompt: 'invented text, invented logo, invented label, altered product geometry, changed composition, changed crop, moved objects, extra objects, flat lighting, ambiguous light direction, missing cast shadow',
    },
  }));
}

function removePlan(request: FalToolRequest): FalWorkflowPlan {
  const source = requireSource(request);
  const mask = request.maskImageUrl?.trim();
  if (!mask) throw new Error('去除任务必须先绘制有效蒙版');
  return {
    modelId: FAL_ERASER_MODEL,
    invocations: [{
      modelId: FAL_ERASER_MODEL,
      input: {
        image_url: source,
        mask_url: mask,
        mask_type: 'manual',
        preserve_alpha: true,
      },
    }],
  };
}

function extractPlan(request: FalToolRequest): FalWorkflowPlan {
  const source = requireSource(request);
  return {
    modelId: FAL_BACKGROUND_REMOVE_MODEL,
    invocations: [{
      modelId: FAL_BACKGROUND_REMOVE_MODEL,
      input: { image_url: source },
    }],
  };
}

function sourceRatioMatchesTarget(request: FalToolRequest): boolean {
  const width = request.sourceWidth ?? 1024;
  const height = request.sourceHeight ?? 1024;
  const [targetWidth, targetHeight] = requireImageSize(request.ratio);
  return Math.abs(width / height - targetWidth / targetHeight) < 0.01;
}

function expandPlan(request: FalToolRequest): FalWorkflowPlan {
  const source = requireSource(request);
  const count = outputCount(request);
  const [canvasWidth, canvasHeight] = requireImageSize(request.ratio);
  const scale = numberParameter(request.parameters, 'expandScale', 72, 20, 100, '原图缩放');
  if (scale === 100 && sourceRatioMatchesTarget(request)) {
    throw new Error('当前设置没有可扩展区域');
  }
  const sourceWidth = request.sourceWidth ?? 1024;
  const sourceHeight = request.sourceHeight ?? 1024;
  const maxWidth = canvasWidth * scale / 100;
  const maxHeight = canvasHeight * scale / 100;
  const fitScale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const originalWidth = Math.max(1, Math.round(sourceWidth * fitScale));
  const originalHeight = Math.max(1, Math.round(sourceHeight * fitScale));
  const anchorValue = request.parameters.expandAnchor;
  const anchor = typeof anchorValue === 'string' && expandAnchors.has(anchorValue)
    ? anchorValue
    : 'center';
  const [vertical, horizontal] = anchor.includes('-')
    ? anchor.split('-')
    : anchor === 'top' || anchor === 'bottom'
      ? [anchor, 'center']
      : anchor === 'left' || anchor === 'right'
        ? ['center', anchor]
        : ['center', 'center'];
  const x = horizontal === 'left'
    ? 0
    : horizontal === 'right'
      ? canvasWidth - originalWidth
      : Math.round((canvasWidth - originalWidth) / 2);
  const y = vertical === 'top'
    ? 0
    : vertical === 'bottom'
      ? canvasHeight - originalHeight
      : Math.round((canvasHeight - originalHeight) / 2);
  const prompt = request.prompt.trim();

  return {
    modelId: FAL_EXPAND_MODEL,
    invocations: Array.from({ length: count }, (_, index) => ({
      modelId: FAL_EXPAND_MODEL,
      input: {
        image_url: source,
        canvas_size: [canvasWidth, canvasHeight],
        original_image_size: [originalWidth, originalHeight],
        original_image_location: [x, y],
        ...(prompt ? { prompt } : {}),
        seed: 4100 + index,
      },
    })),
  };
}

function upscaleFactors(totalFactor: number): number[] {
  const factors: number[] = [];
  let remaining = totalFactor;
  while (remaining > 1.001) {
    const factor = Math.min(4, remaining);
    factors.push(Math.round(factor * 1000) / 1000);
    remaining /= factor;
  }
  return factors;
}

function topazInput(imageUrl: string, factor: number, detail: number): Record<string, unknown> {
  return {
    image_url: imageUrl,
    model: 'Recovery V2',
    upscale_factor: factor,
    crop_to_fill: false,
    output_format: 'png',
    subject_detection: 'All',
    face_enhancement: false,
    detail,
  };
}

function upscalePlan(request: FalToolRequest): FalWorkflowPlan {
  const source = requireSource(request);
  const target = Number(request.parameters.upscaleSize ?? 2048);
  if (!Number.isFinite(target) || target < 1) throw new Error('目标尺寸无效');
  const sourceLongEdge = Math.max(request.sourceWidth ?? 1024, request.sourceHeight ?? 1024);
  if (target <= sourceLongEdge) throw new Error('输入图片已达到目标尺寸');
  const factors = upscaleFactors(target / sourceLongEdge);
  const detail = numberParameter(request.parameters, 'detailLevel', 60, 0, 100, '细节增强') / 100;
  return {
    modelId: FAL_UPSCALE_MODEL,
    invocations: [{
      modelId: FAL_UPSCALE_MODEL,
      input: topazInput(source, factors[0], detail),
    }],
    upscaleFactors: factors,
  };
}

export function buildFalWorkflowPlan(request: FalToolRequest): FalWorkflowPlan {
  switch (request.profileId) {
    case 'generate':
      return productShotPlan(request, false);
    case 'blend':
      return productShotPlan(request, true);
    case 'angle': {
      const input = buildMultipleAnglesInput({
        imageUrls: request.imageUrls,
        ratio: request.ratio,
        outputCount: outputCount(request),
        parameters: request.parameters,
      });
      return {
        modelId: FAL_MULTIPLE_ANGLES_MODEL,
        invocations: [{ modelId: FAL_MULTIPLE_ANGLES_MODEL, input }],
      };
    }
    case 'light':
      return lightPlan(request);
    case 'remove':
      return removePlan(request);
    case 'extract':
      return extractPlan(request);
    case 'expand':
      return expandPlan(request);
    case 'upscale':
      return upscalePlan(request);
  }
}

function normalizedImage(image: unknown): FalGeneratedImage | null {
  if (!image || typeof image !== 'object') return null;
  const input = image as Record<string, unknown>;
  if (typeof input.url !== 'string' || !input.url.trim()) return null;
  return {
    url: input.url,
    ...(typeof input.content_type === 'string' ? { contentType: input.content_type } : {}),
    ...(typeof input.file_name === 'string' ? { fileName: input.file_name } : {}),
    ...(typeof input.file_size === 'number' ? { fileSize: input.file_size } : {}),
    ...(typeof input.width === 'number' ? { width: input.width } : {}),
    ...(typeof input.height === 'number' ? { height: input.height } : {}),
  };
}

export function normalizeFalResult(data: unknown): NormalizedFalResult {
  const input = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const candidates = Array.isArray(input.images)
    ? input.images
    : input.image
      ? [input.image]
      : [];
  const images = candidates.map(normalizedImage).filter((image): image is FalGeneratedImage => Boolean(image));
  return {
    images,
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
  };
}

export function buildNextUpscaleInvocation(
  imageUrl: string,
  factor: number,
  parameters: Record<string, unknown>,
): FalInvocation {
  const detail = numberParameter(parameters, 'detailLevel', 60, 0, 100, '细节增强') / 100;
  return {
    modelId: FAL_UPSCALE_MODEL,
    input: topazInput(imageUrl, factor, detail),
  };
}
