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

export function buildFocusNodeIds(anchorNodeId: string, targetNodeIds: string[]): string[] {
  const targets = [...new Set(targetNodeIds)]
    .filter((nodeId) => nodeId !== anchorNodeId)
    .sort((left, right) => left.localeCompare(right));
  return [anchorNodeId, ...targets];
}

export function shouldApplyAutoFocus(requestRevision: number, userRevision: number): boolean {
  return requestRevision >= userRevision;
}
