import { describe, expect, it } from 'vitest';
import {
  buildFocusNodeIds,
  choosePanelPlacement,
  shouldApplyAutoFocus,
} from '../src/workbench/viewportDirector';

describe('viewport director', () => {
  const viewport = { left: 240, right: 1440, top: 48, bottom: 900 };
  const panel = { width: 320, height: 540 };

  it('places the panel on the side with enough room', () => {
    expect(choosePanelPlacement(
      { left: 1040, right: 1280, top: 200, bottom: 520 },
      viewport,
      panel,
      16,
    )).toBe('left');

    expect(choosePanelPlacement(
      { left: 320, right: 560, top: 200, bottom: 520 },
      viewport,
      panel,
      16,
    )).toBe('right');
  });

  it('prefers the right side when both sides fit', () => {
    expect(choosePanelPlacement(
      { left: 760, right: 1000, top: 200, bottom: 520 },
      { left: 0, right: 1920, top: 0, bottom: 1080 },
      panel,
      16,
    )).toBe('right');
  });

  it('uses the larger side when the panel cannot fully fit', () => {
    expect(choosePanelPlacement(
      { left: 430, right: 670, top: 200, bottom: 520 },
      { left: 240, right: 900, top: 48, bottom: 760 },
      panel,
      16,
    )).toBe('right');
  });

  it('keeps source and generated targets in a stable focus request', () => {
    expect(buildFocusNodeIds('scene:source', ['result:2', 'result:1', 'result:2']))
      .toEqual(['scene:source', 'result:1', 'result:2']);
    expect(buildFocusNodeIds('scene:source', ['scene:source', 'job:1']))
      .toEqual(['scene:source', 'job:1']);
  });

  it('rejects automatic focus after a newer user viewport gesture', () => {
    expect(shouldApplyAutoFocus(3, 4)).toBe(false);
    expect(shouldApplyAutoFocus(4, 4)).toBe(true);
    expect(shouldApplyAutoFocus(5, 4)).toBe(true);
  });
});
