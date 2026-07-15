import { describe, expect, it } from 'vitest';
import {
  buildFocusNodeIds,
  choosePanelPlacement,
  isUserViewportGesture,
  placeNodePicker,
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

  it('keeps a node picker at the release point when the center has room', () => {
    expect(placeNodePicker(
      { x: 800, y: 400 },
      viewport,
      { width: 320, height: 420 },
      16,
    )).toEqual({
      position: { x: 560, y: 352 },
      panelPlacement: 'right',
    });
  });

  it('clamps a node picker inside all four viewport edges', () => {
    const picker = { width: 320, height: 420 };

    expect(placeNodePicker({ x: 245, y: 300 }, viewport, picker, 16))
      .toMatchObject({ position: { x: 16, y: 252 }, panelPlacement: 'right' });
    expect(placeNodePicker({ x: 1420, y: 300 }, viewport, picker, 16))
      .toMatchObject({ position: { x: 864, y: 252 }, panelPlacement: 'left' });
    expect(placeNodePicker({ x: 720, y: 49 }, viewport, picker, 16))
      .toMatchObject({ position: { x: 480, y: 16 } });
    expect(placeNodePicker({ x: 720, y: 895 }, viewport, picker, 16))
      .toMatchObject({ position: { x: 480, y: 416 } });
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

  it('does not treat programmatic viewport movement as a user gesture', () => {
    expect(isUserViewportGesture(null)).toBe(false);
    expect(isUserViewportGesture({ type: 'pointerdown' })).toBe(true);
  });
});
