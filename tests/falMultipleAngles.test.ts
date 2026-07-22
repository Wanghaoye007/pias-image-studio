import { describe, expect, it } from 'vitest';
import { parseFalKey } from '../src/server/fal/falCredentials';
import {
  buildMultipleAnglesInput,
  FAL_MULTIPLE_ANGLES_MODEL,
} from '../src/shared/fal/multipleAngles';

describe('Fal 多角度输入契约', () => {
  it('使用官方模型 ID，并把工作台参数映射为 Fal 输入', () => {
    expect(FAL_MULTIPLE_ANGLES_MODEL).toBe(
      'fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles',
    );

    expect(buildMultipleAnglesInput({
      imageUrls: ['data:image/png;base64,AA=='],
      ratio: '4:5',
      outputCount: 2,
      parameters: {
        horizontalAngle: -45,
        moveForward: 4,
        verticalView: -0.5,
        wideAngle: true,
      },
    })).toEqual({
      image_urls: ['data:image/png;base64,AA=='],
      image_size: { width: 1024, height: 1280 },
      guidance_scale: 1,
      num_inference_steps: 6,
      acceleration: 'regular',
      negative_prompt: ' ',
      enable_safety_checker: true,
      output_format: 'png',
      num_images: 2,
      rotate_right_left: -45,
      move_forward: 4,
      vertical_angle: -0.5,
      wide_angle_lens: true,
      lora_scale: 1.25,
    });
  });

  it.each([
    ['1:1', { width: 1024, height: 1024 }],
    ['4:5', { width: 1024, height: 1280 }],
    ['3:4', { width: 960, height: 1280 }],
    ['4:3', { width: 1280, height: 960 }],
    ['16:9', { width: 1280, height: 720 }],
    ['9:16', { width: 720, height: 1280 }],
  ])('把 %s 映射为固定宽高', (ratio, imageSize) => {
    expect(buildMultipleAnglesInput({
      imageUrls: ['https://example.com/product.png'],
      ratio,
      outputCount: 1,
      parameters: {},
    }).image_size).toEqual(imageSize);
  });

  it('拒绝空图片、未知比例、非法数量和越界参数', () => {
    const valid = {
      imageUrls: ['https://example.com/product.png'],
      ratio: '1:1',
      outputCount: 1,
      parameters: {},
    };

    expect(() => buildMultipleAnglesInput({ ...valid, imageUrls: [] })).toThrow('输入图片');
    expect(() => buildMultipleAnglesInput({ ...valid, ratio: '2:3' })).toThrow('画面比例');
    expect(() => buildMultipleAnglesInput({ ...valid, outputCount: 5 })).toThrow('输出数量');
    expect(() => buildMultipleAnglesInput({
      ...valid,
      parameters: { horizontalAngle: 91 },
    })).toThrow('水平旋转');
    expect(() => buildMultipleAnglesInput({
      ...valid,
      parameters: { horizontalAngle: -91 },
    })).toThrow('水平旋转');
    expect(() => buildMultipleAnglesInput({
      ...valid,
      parameters: { moveForward: -1 },
    })).toThrow('镜头推进');
    expect(() => buildMultipleAnglesInput({
      ...valid,
      parameters: { verticalView: 1.1 },
    })).toThrow('垂直视角');
  });

  it('接受 Fal 官方模型的水平旋转边界', () => {
    const base = {
      imageUrls: ['https://example.com/product.png'],
      ratio: '1:1',
      outputCount: 1,
    };

    expect(buildMultipleAnglesInput({
      ...base,
      parameters: { horizontalAngle: -90 },
    }).rotate_right_left).toBe(-90);
    expect(buildMultipleAnglesInput({
      ...base,
      parameters: { horizontalAngle: 90 },
    }).rotate_right_left).toBe(90);
  });
});

describe('Fal Key 解析', () => {
  it.each([
    ['abc:def', 'abc:def'],
    ['FAL_KEY=abc:def\n', 'abc:def'],
    ['```env\nFAL_KEY="abc:def"\n```', 'abc:def'],
  ])('从本地文件格式中提取凭证', (raw, expected) => {
    expect(parseFalKey(raw)).toBe(expected);
  });

  it('拒绝空内容和无法识别的说明文本', () => {
    expect(() => parseFalKey('')).toThrow('Fal 服务凭证未配置');
    expect(() => parseFalKey('# Fal key 请填写在这里')).toThrow('Fal 服务凭证未配置');
  });
});
