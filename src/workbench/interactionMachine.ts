import type { TaskProfileId } from '../domain';

export type InteractionMode =
  | 'idle'
  | 'node-selected'
  | 'connecting-node'
  | 'choosing-node-type'
  | 'configuring-draft-node'
  | 'configuring'
  | 'picking-asset'
  | 'editing-light'
  | 'editing-expand'
  | 'editing-angle'
  | 'editing-remove'
  | 'submitting';

export type PanelPlacement = 'left' | 'right';

export type DraftNodeCreation = {
  sourceNodeId: string;
  screenPosition: { x: number; y: number };
  canvasPosition: { x: number; y: number };
  placement: PanelPlacement;
  selectedTool: TaskProfileId | null;
};

export type WorkbenchInteractionState = {
  mode: InteractionMode;
  selectedNodeIds: string[];
  activeTool: TaskProfileId | null;
  anchorNodeId: string | null;
  panelOpen: boolean;
  assetPickerOpen: boolean;
  panelPlacement: PanelPlacement;
  draftNode: DraftNodeCreation | null;
};

export type WorkbenchInteractionEvent =
  | { type: 'SELECT_NODE'; nodeId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'BEGIN_NODE_CONNECTION'; sourceNodeId: string }
  | {
      type: 'SHOW_NODE_PICKER';
      screenPosition: { x: number; y: number };
      canvasPosition: { x: number; y: number };
      placement: PanelPlacement;
    }
  | { type: 'SELECT_DRAFT_TOOL'; tool: TaskProfileId }
  | { type: 'CANCEL_NODE_CREATION' }
  | { type: 'OPEN_TOOL'; tool: TaskProfileId }
  | { type: 'CLOSE_TOOL' }
  | { type: 'OPEN_ASSET_PICKER' }
  | { type: 'CLOSE_ASSET_PICKER' }
  | { type: 'SET_PANEL_PLACEMENT'; placement: PanelPlacement }
  | { type: 'SUBMIT' }
  | { type: 'SUBMISSION_SETTLED'; nodeId: string }
  | { type: 'RESET'; nodeId: string };

export function createInitialInteractionState(nodeId: string): WorkbenchInteractionState {
  return {
    mode: 'node-selected',
    selectedNodeIds: [nodeId],
    activeTool: null,
    anchorNodeId: nodeId,
    panelOpen: false,
    assetPickerOpen: false,
    panelPlacement: 'right',
    draftNode: null,
  };
}

export function reduceWorkbenchInteraction(
  state: WorkbenchInteractionState,
  event: WorkbenchInteractionEvent,
): WorkbenchInteractionState {
  switch (event.type) {
    case 'SELECT_NODE':
      return {
        ...state,
        mode: 'node-selected',
        selectedNodeIds: [event.nodeId],
        activeTool: null,
        anchorNodeId: event.nodeId,
        panelOpen: false,
        assetPickerOpen: false,
        draftNode: null,
      };
    case 'CLEAR_SELECTION':
      return {
        ...state,
        mode: 'idle',
        selectedNodeIds: [],
        activeTool: null,
        anchorNodeId: null,
        panelOpen: false,
        assetPickerOpen: false,
        draftNode: null,
      };
    case 'BEGIN_NODE_CONNECTION':
      return {
        ...state,
        mode: 'connecting-node',
        selectedNodeIds: [event.sourceNodeId],
        activeTool: null,
        anchorNodeId: event.sourceNodeId,
        panelOpen: false,
        assetPickerOpen: false,
        draftNode: {
          sourceNodeId: event.sourceNodeId,
          screenPosition: { x: 0, y: 0 },
          canvasPosition: { x: 0, y: 0 },
          placement: 'right',
          selectedTool: null,
        },
      };
    case 'SHOW_NODE_PICKER':
      if (!state.draftNode) return state;
      return {
        ...state,
        mode: 'choosing-node-type',
        panelOpen: false,
        assetPickerOpen: false,
        panelPlacement: event.placement,
        draftNode: {
          ...state.draftNode,
          screenPosition: event.screenPosition,
          canvasPosition: event.canvasPosition,
          placement: event.placement,
          selectedTool: null,
        },
      };
    case 'SELECT_DRAFT_TOOL':
      if (!state.draftNode) return state;
      return {
        ...state,
        mode: 'configuring-draft-node',
        activeTool: event.tool,
        anchorNodeId: state.draftNode.sourceNodeId,
        panelOpen: true,
        assetPickerOpen: false,
        panelPlacement: state.draftNode.placement,
        draftNode: { ...state.draftNode, selectedTool: event.tool },
      };
    case 'CANCEL_NODE_CREATION':
      return {
        ...state,
        mode: state.selectedNodeIds.length > 0 ? 'node-selected' : 'idle',
        activeTool: null,
        anchorNodeId: state.selectedNodeIds.at(-1) ?? null,
        panelOpen: false,
        assetPickerOpen: false,
        draftNode: null,
      };
    case 'OPEN_TOOL': {
      const anchorNodeId = state.selectedNodeIds.at(-1);
      if (!anchorNodeId) return state;
      return {
        ...state,
        mode: editingMode(event.tool),
        activeTool: event.tool,
        anchorNodeId,
        panelOpen: true,
        assetPickerOpen: false,
        draftNode: null,
      };
    }
    case 'CLOSE_TOOL':
      return {
        ...state,
        mode: state.selectedNodeIds.length > 0 ? 'node-selected' : 'idle',
        activeTool: null,
        panelOpen: false,
        assetPickerOpen: false,
        draftNode: null,
      };
    case 'OPEN_ASSET_PICKER':
      if (state.activeTool !== 'blend' || !state.panelOpen) return state;
      return { ...state, mode: 'picking-asset', assetPickerOpen: true };
    case 'CLOSE_ASSET_PICKER':
      if (!state.assetPickerOpen) return state;
      return {
        ...state,
        mode: state.draftNode ? 'configuring-draft-node' : 'configuring',
        assetPickerOpen: false,
      };
    case 'SET_PANEL_PLACEMENT':
      return { ...state, panelPlacement: event.placement };
    case 'SUBMIT':
      if (!state.activeTool || !state.anchorNodeId) return state;
      return {
        ...state,
        mode: 'submitting',
        panelOpen: false,
        assetPickerOpen: false,
        draftNode: null,
      };
    case 'SUBMISSION_SETTLED':
      return {
        ...state,
        mode: 'node-selected',
        selectedNodeIds: [event.nodeId],
        activeTool: null,
        anchorNodeId: event.nodeId,
        panelOpen: false,
        assetPickerOpen: false,
        draftNode: null,
      };
    case 'RESET':
      return createInitialInteractionState(event.nodeId);
  }
}

function editingMode(tool: TaskProfileId): InteractionMode {
  if (tool === 'light') return 'editing-light';
  if (tool === 'expand') return 'editing-expand';
  if (tool === 'angle') return 'editing-angle';
  if (tool === 'remove') return 'editing-remove';
  return 'configuring';
}
