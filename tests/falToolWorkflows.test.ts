import { describe, expect, it } from 'vitest';
import {
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

  it('把八方向、强度和色温写入 Fibo 指令并按输出数扇出', () => {
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
    expect(plan.invocations).toHaveLength(4);
    expect(plan.invocations[0].input).toEqual(expect.objectContaining({
      image_url: 'source-image',
      instruction: expect.stringMatching(/top-left.*70%.*4300K/i),
      seed: 5555,
    }));
    expect(plan.invocations[3].input).toEqual(expect.objectContaining({ seed: 5558 }));
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
