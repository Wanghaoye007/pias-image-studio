import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

export type LightDirection =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left';

const lightDirections: Array<{
  id: LightDirection;
  label: string;
  x: number;
  y: number;
}> = [
  { id: 'top-left', label: '左上光', x: 16, y: 16 },
  { id: 'top', label: '上方光', x: 50, y: 8 },
  { id: 'top-right', label: '右上光', x: 84, y: 16 },
  { id: 'right', label: '右侧光', x: 92, y: 50 },
  { id: 'bottom-right', label: '右下光', x: 84, y: 84 },
  { id: 'bottom', label: '下方光', x: 50, y: 92 },
  { id: 'bottom-left', label: '左下光', x: 16, y: 84 },
  { id: 'left', label: '左侧光', x: 8, y: 50 },
];

export function LightOverlay({
  direction,
  onDirectionChange,
}: {
  direction: LightDirection;
  onDirectionChange?: (direction: LightDirection) => void;
}) {
  const selected = lightDirections.find((item) => item.id === direction) ?? lightDirections[2];
  const style = {
    '--light-x': `${selected.x}%`,
    '--light-y': `${selected.y}%`,
  } as CSSProperties;

  const updateFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    const x = (event.clientX - (bounds.left + bounds.width / 2)) / bounds.width;
    const y = (event.clientY - (bounds.top + bounds.height / 2)) / bounds.height;
    const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4));
    const bySector: Record<number, LightDirection> = {
      [-4]: 'left',
      [-3]: 'top-left',
      [-2]: 'top',
      [-1]: 'top-right',
      0: 'right',
      1: 'bottom-right',
      2: 'bottom',
      3: 'bottom-left',
      4: 'left',
    };
    onDirectionChange?.(bySector[sector] ?? 'top-right');
  };

  return (
    <div aria-label="定向光控制" className="light-overlay nodrag" style={style}>
      <span className="light-overlay__beam" />
      {lightDirections.map((item) => (
        <button
          aria-label={`定向光控制柄 ${item.label}`}
          aria-pressed={item.id === direction}
          className="light-overlay__handle"
          data-position={item.id}
          key={item.id}
          onClick={() => onDirectionChange?.(item.id)}
          style={{ left: `${item.x}%`, top: `${item.y}%` }}
          type="button"
        />
      ))}
      <button
        aria-label="定向光控制点"
        className="light-overlay__point"
        data-direction={direction}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateFromPointer(event);
        }}
        type="button"
      />
    </div>
  );
}

export function ExpandOverlay({
  ratio,
  scale,
}: {
  ratio: string;
  scale: number;
}) {
  const style = {
    '--expand-scale': `${Math.min(100, Math.max(36, scale))}%`,
  } as CSSProperties;

  return (
    <div
      aria-label="扩图构图区域"
      className="expand-overlay nodrag"
      data-ratio={ratio}
      data-scale={scale}
      style={style}
    >
      <span aria-hidden="true" className="expand-overlay__original" />
      <div aria-label="扩图范围网格" className="expand-overlay__grid">
        {Array.from({ length: 9 }, (_, index) => (
          <span aria-label={`扩图区域 ${index + 1}`} key={index} />
        ))}
      </div>
    </div>
  );
}

export function AnglePreview({
  horizontal,
  vertical,
}: {
  horizontal: number;
  vertical: number;
}) {
  const style = {
    '--angle-horizontal': `${horizontal}deg`,
    '--angle-elevation': `${Math.max(-30, Math.min(45, vertical))}%`,
  } as CSSProperties;

  return (
    <div
      aria-label="视角预览"
      className="angle-preview nodrag"
      data-horizontal={horizontal}
      data-vertical={vertical}
      style={style}
    >
      <span className="angle-preview__orbit" />
      <span className="angle-preview__camera" />
    </div>
  );
}
