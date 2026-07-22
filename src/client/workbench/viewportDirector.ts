import type { PanelPlacement } from './interactionMachine';

export type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type NodePickerPlacement = {
  position: Point;
  panelPlacement: PanelPlacement;
};

export function choosePanelPlacement(
  anchor: Rect,
  viewport: Rect,
  panel: Size,
  gap = 16,
): PanelPlacement {
  const leftSpace = anchor.left - viewport.left - gap;
  const rightSpace = viewport.right - anchor.right - gap;
  const rightFits = rightSpace >= panel.width;
  const leftFits = leftSpace >= panel.width;

  if (rightFits) return 'right';
  if (leftFits) return 'left';
  return rightSpace >= leftSpace ? 'right' : 'left';
}

export function placeNodePicker(
  releasePoint: Point,
  viewport: Rect,
  picker: Size,
  margin = 16,
): NodePickerPlacement {
  const viewportWidth = viewport.right - viewport.left;
  const viewportHeight = viewport.bottom - viewport.top;
  const maxX = Math.max(margin, viewportWidth - picker.width - margin);
  const maxY = Math.max(margin, viewportHeight - picker.height - margin);

  return {
    position: {
      x: clamp(releasePoint.x - viewport.left, margin, maxX),
      y: clamp(releasePoint.y - viewport.top, margin, maxY),
    },
    panelPlacement: releasePoint.x > viewport.left + viewportWidth / 2 ? 'left' : 'right',
  };
}

export function buildFocusNodeIds(anchorNodeId: string, targetNodeIds: string[]): string[] {
  const targets = [...new Set(targetNodeIds)]
    .filter((nodeId) => nodeId !== anchorNodeId)
    .sort((left, right) => left.localeCompare(right));
  return [anchorNodeId, ...targets];
}

export function shouldApplyAutoFocus(requestRevision: number, userRevision: number): boolean {
  return requestRevision >= userRevision;
}

export function isUserViewportGesture(event: unknown): boolean {
  return event !== null && event !== undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
