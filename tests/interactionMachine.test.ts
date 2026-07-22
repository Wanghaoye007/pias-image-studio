import { describe, expect, it } from 'vitest';
import {
  createInitialInteractionState,
  reduceWorkbenchInteraction,
} from '../src/client/workbench/interactionMachine';

describe('workbench interaction machine', () => {
  it('opens a tool against the selected node and enters its editing mode', () => {
    const selected = reduceWorkbenchInteraction(
      createInitialInteractionState('scene:scene-source'),
      { type: 'OPEN_TOOL', tool: 'light' },
    );

    expect(selected).toMatchObject({
      mode: 'editing-light',
      activeTool: 'light',
      anchorNodeId: 'scene:scene-source',
      panelOpen: true,
    });
  });

  it('maps expand, angle, and remove tools to image-surface editing modes', () => {
    const initial = createInitialInteractionState('result:result-1');

    expect(reduceWorkbenchInteraction(initial, { type: 'OPEN_TOOL', tool: 'expand' }).mode)
      .toBe('editing-expand');
    expect(reduceWorkbenchInteraction(initial, { type: 'OPEN_TOOL', tool: 'angle' }).mode)
      .toBe('editing-angle');
    expect(reduceWorkbenchInteraction(initial, { type: 'OPEN_TOOL', tool: 'remove' }).mode)
      .toBe('editing-remove');
  });

  it('returns from the asset picker to the blend configuration', () => {
    const opened = reduceWorkbenchInteraction(
      reduceWorkbenchInteraction(
        createInitialInteractionState('scene:scene-source'),
        { type: 'OPEN_TOOL', tool: 'blend' },
      ),
      { type: 'OPEN_ASSET_PICKER' },
    );

    expect(opened).toMatchObject({ mode: 'picking-asset', assetPickerOpen: true });
    expect(reduceWorkbenchInteraction(opened, { type: 'CLOSE_ASSET_PICKER' })).toMatchObject({
      mode: 'configuring',
      assetPickerOpen: false,
      panelOpen: true,
    });
  });

  it('clears temporary layers when submission starts', () => {
    const editing = reduceWorkbenchInteraction(
      createInitialInteractionState('result:result-1'),
      { type: 'OPEN_TOOL', tool: 'expand' },
    );

    expect(reduceWorkbenchInteraction(editing, { type: 'SUBMIT' })).toMatchObject({
      mode: 'submitting',
      panelOpen: false,
      assetPickerOpen: false,
    });
  });

  it('does not open tools without a selected node', () => {
    const empty = reduceWorkbenchInteraction(
      createInitialInteractionState('scene:scene-source'),
      { type: 'CLEAR_SELECTION' },
    );

    expect(reduceWorkbenchInteraction(empty, { type: 'OPEN_TOOL', tool: 'generate' }))
      .toEqual(empty);
  });

  it('resets all transient state to the supplied source node', () => {
    const selectingAsset = reduceWorkbenchInteraction(
      reduceWorkbenchInteraction(
        createInitialInteractionState('result:result-1'),
        { type: 'OPEN_TOOL', tool: 'blend' },
      ),
      { type: 'OPEN_ASSET_PICKER' },
    );

    expect(reduceWorkbenchInteraction(selectingAsset, {
      type: 'RESET',
      nodeId: 'scene:scene-source',
    })).toEqual(createInitialInteractionState('scene:scene-source'));
  });

  it('opens a node picker at the released canvas position', () => {
    const connected = reduceWorkbenchInteraction(
      createInitialInteractionState('scene:scene-source'),
      { type: 'BEGIN_NODE_CONNECTION', sourceNodeId: 'scene:scene-source' },
    );
    const choosing = reduceWorkbenchInteraction(connected, {
      type: 'SHOW_NODE_PICKER',
      screenPosition: { x: 720, y: 420 },
      canvasPosition: { x: 980, y: 560 },
      placement: 'left',
    });

    expect(connected).toMatchObject({ mode: 'connecting-node' });
    expect(choosing).toMatchObject({
      mode: 'choosing-node-type',
      draftNode: {
        sourceNodeId: 'scene:scene-source',
        screenPosition: { x: 720, y: 420 },
        canvasPosition: { x: 980, y: 560 },
        placement: 'left',
        selectedTool: null,
      },
    });
  });

  it('keeps a transient draft while the selected node type is configured', () => {
    const connected = reduceWorkbenchInteraction(
      createInitialInteractionState('result:result-1'),
      { type: 'BEGIN_NODE_CONNECTION', sourceNodeId: 'result:result-1' },
    );
    const choosing = reduceWorkbenchInteraction(connected, {
      type: 'SHOW_NODE_PICKER',
      screenPosition: { x: 640, y: 360 },
      canvasPosition: { x: 840, y: 460 },
      placement: 'right',
    });
    const configuring = reduceWorkbenchInteraction(choosing, {
      type: 'SELECT_DRAFT_TOOL', tool: 'blend',
    });

    expect(configuring).toMatchObject({
      mode: 'configuring-draft-node',
      activeTool: 'blend',
      anchorNodeId: 'result:result-1',
      panelOpen: true,
      draftNode: { selectedTool: 'blend' },
    });
  });

  it('cancels transient node creation without clearing the source selection', () => {
    const connected = reduceWorkbenchInteraction(
      createInitialInteractionState('scene:scene-source'),
      { type: 'BEGIN_NODE_CONNECTION', sourceNodeId: 'scene:scene-source' },
    );

    expect(reduceWorkbenchInteraction(connected, { type: 'CANCEL_NODE_CREATION' }))
      .toEqual(createInitialInteractionState('scene:scene-source'));
  });

  it('clears a stale draft when another node is selected', () => {
    const connected = reduceWorkbenchInteraction(
      createInitialInteractionState('scene:scene-source'),
      { type: 'BEGIN_NODE_CONNECTION', sourceNodeId: 'scene:scene-source' },
    );

    expect(reduceWorkbenchInteraction(connected, {
      type: 'SELECT_NODE', nodeId: 'result:result-2',
    })).toEqual(createInitialInteractionState('result:result-2'));
  });
});
