import { describe, expect, it } from 'vitest';
import {
  buildDirectionalLightInvocations,
  buildFalWorkflowPlan,
  normalizeFalResult,
  type FalToolRequest,
} from '../src/fal/toolWorkflows';

function request(overrides: Partial<FalToolRequest> = {}): FalToolRequest {
  return {
    profileId: 'generate',
    imageUrls: ['source-image'],
    prompt: '',
    ratio: '1:1',
    outputCount: 1,
    parameters: {},
    sourceWidth: 512,
    sourceHeight: 512,
    ...overrides,
  };
}

describe('Fal 图片工具适配器', () => {
  it('把生成节点映射到 Product Shot 的场景描述和原生多结果', () => {
    const plan = buildFalWorkflowPlan(request({
      outputCount: 4,
      ratio: '4:5',
      parameters: { sceneTemplate: '纯净棚拍', quality: '精细' },
    }));

    expect(plan.modelId).toBe('fal-ai/bria/product-shot');
    expect(plan.invocations).toHaveLength(1);
    expect(plan.invocations[0]).toEqual({
      modelId: 'fal-ai/bria/product-shot',
      input: expect.objectContaining({
        image_url: 'source-image',
        scene_description: expect.stringContaining('studio'),
        num_results: 4,
        fast: false,
        placement_type: 'manual_placement',
        manual_placement_selection: 'bottom_center',
        shot_size: [1024, 1280],
      }),
    });
  });

  it('生成与扩图保留中文补充描述，不静默丢弃用户输入', () => {
    const generated = buildFalWorkflowPlan(request({ prompt: '保留瓶身文字，增加水面倒影' }));
    const expanded = buildFalWorkflowPlan(request({
      profileId: 'expand',
      prompt: '延展为纯净的浅灰摄影棚背景',
      parameters: { expandScale: 70 },
    }));

    expect(generated.invocations[0].input.scene_description).toContain('保留瓶身文字，增加水面倒影');
    expect(expanded.invocations[0].input.prompt).toBe('延展为纯净的浅灰摄影棚背景');
  });

  it('把融图的商品图与场景图映射到明确角色', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'blend',
      imageUrls: ['product-image', 'scene-image'],
      ratio: '16:9',
      outputCount: 2,
      parameters: { productPlacement: 'center_vertical' },
    }));

    expect(plan.invocations[0].input).toEqual(expect.objectContaining({
      image_url: 'product-image',
      ref_image_url: 'scene-image',
      num_results: 2,
      shot_size: [1280, 720],
      manual_placement_selection: 'center_vertical',
    }));
    expect(plan.invocations[0].input).not.toHaveProperty('scene_description');
  });

  it('沿用多角度官方字段和原生多结果', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'angle',
      imageUrls: ['front', 'side'],
      outputCount: 2,
      parameters: {
        horizontalAngle: -45,
        moveForward: 3,
        verticalView: 0.4,
        wideAngle: true,
      },
    }));

    expect(plan.modelId).toContain('multiple-angles');
    expect(plan.invocations).toHaveLength(1);
    expect(plan.invocations[0].input).toEqual(expect.objectContaining({
      image_urls: ['front', 'side'],
      rotate_right_left: -45,
      move_forward: 3,
      vertical_angle: 0.4,
      wide_angle_lens: true,
      num_images: 2,
    }));
  });

  it('先把斜向主光交给结构化指令端点解析，再记录最终出图数量', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'light',
      outputCount: 4,
      prompt: 'soft commercial light',
      parameters: {
        lightDirection: 'top-left',
        lightIntensity: 70,
        lightTemperature: 4300,
      },
    }));

    expect(plan.modelId).toBe('bria/fibo-edit/edit');
    expect(plan.invocations).toHaveLength(1);
    expect(plan.invocations[0]).toEqual({
      modelId: 'bria/fibo-edit/edit/structured_instruction',
      input: expect.objectContaining({
        image_url: 'source-image',
        instruction: expect.stringMatching(/top-left.*70%.*4300K/i),
        seed: 5555,
      }),
    });
    expect(plan.directionalLight).toEqual(expect.objectContaining({
      sourceImageUrl: 'source-image',
      outputCount: 4,
    }));
  });

  it('把前方主光与轮廓光写成可验证的受光面和阴影指令', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'light',
      parameters: {
        lightDirection: 'front',
        lightIntensity: 50,
        lightTemperature: 5200,
        lightSmartMode: true,
        rimLight: true,
      },
    }));

    expect(plan.modelId).toBe('bria/fibo-edit/edit');
    expect(plan.invocations[0].input).toEqual(expect.objectContaining({
      image_url: 'source-image',
      instruction: expect.stringMatching(/front-facing surfaces.*shadows behind.*rim light/i),
      seed: 5555,
    }));
  });

  it('把亮度和色温原值写入方向编辑指令', () => {
    const warm = buildFalWorkflowPlan(request({
      profileId: 'light',
      parameters: { lightDirection: 'front', lightIntensity: 80, lightTemperature: 3200 },
    }));
    const cool = buildFalWorkflowPlan(request({
      profileId: 'light',
      parameters: { lightDirection: 'top', lightIntensity: 50, lightTemperature: 7000 },
    }));

    expect(warm.invocations[0].input.instruction).toMatch(/80%.*3200K/i);
    expect(cool.invocations[0].input.instruction).toMatch(/50%.*7000K/i);
    expect(cool.invocations[0].input.instruction).toMatch(/top-facing surfaces.*shadows directly below/i);
  });

  it('十个方向都使用独立的受光面与反向阴影语义', () => {
    const directions = {
      'top-left': /upper-left.*lower-right/i,
      top: /top-facing surfaces.*directly below/i,
      'top-right': /upper-right.*lower-left/i,
      right: /right-facing surfaces.*toward the left/i,
      'bottom-right': /lower-right.*upper-left/i,
      bottom: /lower surfaces.*upward/i,
      'bottom-left': /lower-left.*upper-right/i,
      left: /left-facing surfaces.*toward the right/i,
      front: /front-facing surfaces.*behind/i,
      back: /rim.*front face.*darker/i,
    };
    Object.entries(directions).forEach(([lightDirection, instructionPattern]) => {
      const plan = buildFalWorkflowPlan(request({
        profileId: 'light',
        parameters: { lightDirection, lightIntensity: 60, lightTemperature: 5200 },
      }));
      expect(plan.modelId).toBe('bria/fibo-edit/edit');
      expect(plan.invocations[0].input.instruction).toMatch(instructionPattern);
      expect(plan.invocations[0].modelId).toBe('bria/fibo-edit/edit/structured_instruction');
    });
  });

  it('用完整结构化结果构建最终方向光出图，并禁止凭空生成文字和改动构图', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'light',
      outputCount: 2,
      parameters: { lightDirection: 'left', lightIntensity: 80, lightTemperature: 5200 },
    }));
    const structuredInstruction = {
      objects: [{ description: 'blank cosmetic bottle' }],
      lighting: { direction: 'camera-left', shadows: 'toward camera-right' },
      text_render: [],
    };

    expect(buildDirectionalLightInvocations(plan, structuredInstruction)).toEqual([
      {
        modelId: 'bria/fibo-edit/edit',
        input: expect.objectContaining({
          image_url: 'source-image',
          structured_instruction: structuredInstruction,
          seed: 5555,
          guidance_scale: 5,
          negative_prompt: expect.stringMatching(/invented text.*changed composition/i),
        }),
      },
      {
        modelId: 'bria/fibo-edit/edit',
        input: expect.objectContaining({ seed: 5556 }),
      },
    ]);
  });

  it('去除节点要求笔刷蒙版并固定单结果', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'remove',
      outputCount: 4,
      maskImageUrl: 'mask-image',
    }));

    expect(plan.modelId).toBe('fal-ai/bria/eraser');
    expect(plan.invocations).toEqual([{
      modelId: 'fal-ai/bria/eraser',
      input: {
        image_url: 'source-image',
        mask_url: 'mask-image',
        mask_type: 'manual',
        preserve_alpha: true,
      },
    }]);
  });

  it('抠图节点调用 RMBG 并固定单结果', () => {
    const plan = buildFalWorkflowPlan(request({ profileId: 'extract', outputCount: 4 }));

    expect(plan).toEqual({
      modelId: 'fal-ai/bria/background/remove',
      invocations: [{
        modelId: 'fal-ai/bria/background/remove',
        input: { image_url: 'source-image' },
      }],
    });
  });

  it('扩图把比例、缩放和九宫格锚点映射为画布坐标并扇出', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'expand',
      ratio: '16:9',
      outputCount: 2,
      parameters: { expandScale: 50, expandAnchor: 'right' },
    }));

    expect(plan.modelId).toBe('fal-ai/bria/expand');
    expect(plan.invocations).toHaveLength(2);
    expect(plan.invocations[0].input).toEqual(expect.objectContaining({
      image_url: 'source-image',
      canvas_size: [1280, 720],
      original_image_size: [360, 360],
      original_image_location: [920, 180],
      seed: 4100,
    }));
    expect(plan.invocations[1].input).toEqual(expect.objectContaining({ seed: 4101 }));
  });

  it('超分按目标长边生成不超过四倍的顺序阶段', () => {
    const plan = buildFalWorkflowPlan(request({
      profileId: 'upscale',
      parameters: { upscaleSize: '8192', detailLevel: 60 },
    }));

    expect(plan.modelId).toBe('fal-ai/topaz/upscale/image');
    expect(plan.upscaleFactors).toEqual([4, 4]);
    expect(plan.invocations[0]).toEqual({
      modelId: 'fal-ai/topaz/upscale/image',
      input: expect.objectContaining({
        image_url: 'source-image',
        model: 'High Fidelity V2',
        upscale_factor: 4,
        output_format: 'png',
        face_enhancement: false,
        sharpen: 0.6,
      }),
    });
  });

  it('标准化 images 和 image 两类 Fal 输出', () => {
    expect(normalizeFalResult({
      images: [{ url: 'a.png', width: 100, height: 200 }],
      seed: 12,
    })).toEqual({ images: [{ url: 'a.png', width: 100, height: 200 }], seed: 12 });
    expect(normalizeFalResult({
      image: { url: 'b.png', content_type: 'image/png' },
    })).toEqual({ images: [{ url: 'b.png', contentType: 'image/png' }] });
  });

  it('拒绝缺少必要输入和无意义扩图', () => {
    expect(() => buildFalWorkflowPlan(request({ imageUrls: [] }))).toThrow('输入图片');
    expect(() => buildFalWorkflowPlan(request({ profileId: 'blend' }))).toThrow('目标场景');
    expect(() => buildFalWorkflowPlan(request({ profileId: 'remove' }))).toThrow('蒙版');
    expect(() => buildFalWorkflowPlan(request({
      profileId: 'expand',
      parameters: { expandScale: 100 },
    }))).toThrow('没有可扩展区域');
  });
});
