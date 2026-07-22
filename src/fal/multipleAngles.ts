export const FAL_MULTIPLE_ANGLES_MODEL =
  'fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles';
export const FAL_HORIZONTAL_ANGLE_MIN = -90;
export const FAL_HORIZONTAL_ANGLE_MAX = 90;

export function clampFalHorizontalAngle(value: number): number {
  return Math.max(FAL_HORIZONTAL_ANGLE_MIN, Math.min(FAL_HORIZONTAL_ANGLE_MAX, value));
}

export type FalImageSize = { width: number; height: number };

export type MultipleAnglesRequest = {
  imageUrls: string[];
  ratio: string;
  outputCount: number;
  parameters: Record<string, unknown>;
};

export type FalMultipleAnglesInput = {
  image_urls: string[];
  image_size: FalImageSize;
  guidance_scale: number;
  num_inference_steps: number;
  acceleration: 'regular';
  negative_prompt: string;
  enable_safety_checker: boolean;
  output_format: 'png';
  num_images: number;
  rotate_right_left: number;
  move_forward: number;
  vertical_angle: number;
  wide_angle_lens: boolean;
  lora_scale: number;
};

export type FalGeneratedImage = {
  url: string;
  contentType?: string;
  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

export type FalMultipleAnglesResult = {
  images: FalGeneratedImage[];
  seed?: number;
};

const imageSizes: Record<string, FalImageSize> = {
  '1:1': { width: 1024, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '3:4': { width: 960, height: 1280 },
  '4:3': { width: 1280, height: 960 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
};

function numberParameter(
  parameters: Record<string, unknown>,
  key: string,
  label: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = parameters[key] ?? fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
    throw new Error(`${label}必须在 ${min} 到 ${max} 之间`);
  }
  return raw;
}

export function buildMultipleAnglesInput(request: MultipleAnglesRequest): FalMultipleAnglesInput {
  const imageUrls = request.imageUrls.map((url) => url.trim()).filter(Boolean);
  if (imageUrls.length === 0) {
    throw new Error('多角度任务至少需要一张输入图片');
  }
  const imageSize = imageSizes[request.ratio];
  if (!imageSize) {
    throw new Error(`不支持的画面比例：${request.ratio}`);
  }
  if (!Number.isInteger(request.outputCount) || request.outputCount < 1 || request.outputCount > 4) {
    throw new Error('输出数量必须为 1 到 4 的整数');
  }
  const wideAngle = request.parameters.wideAngle ?? false;
  if (typeof wideAngle !== 'boolean') {
    throw new Error('广角镜头参数必须为布尔值');
  }

  return {
    image_urls: imageUrls,
    image_size: imageSize,
    guidance_scale: 1,
    num_inference_steps: 6,
    acceleration: 'regular',
    negative_prompt: ' ',
    enable_safety_checker: true,
    output_format: 'png',
    num_images: request.outputCount,
    rotate_right_left: numberParameter(
      request.parameters,
      'horizontalAngle',
      '水平旋转',
      0,
      FAL_HORIZONTAL_ANGLE_MIN,
      FAL_HORIZONTAL_ANGLE_MAX,
    ),
    move_forward: numberParameter(
      request.parameters,
      'moveForward',
      '镜头推进',
      0,
      0,
      10,
    ),
    vertical_angle: numberParameter(
      request.parameters,
      'verticalView',
      '垂直视角',
      0,
      -1,
      1,
    ),
    wide_angle_lens: wideAngle,
    lora_scale: 1.25,
  };
}
