import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

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
  const offsetX = selected.x - 50;
  const offsetY = selected.y - 50;
  const style = {
    '--light-angle': `${Math.round(Math.atan2(offsetY, offsetX) * 180 / Math.PI)}deg`,
    '--light-length': `${Math.min(84, Math.hypot(offsetX, offsetY) * 1.55)}%`,
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
    <div aria-label="定向光控制" className="light-overlay nodrag" data-overlay="light" style={style}>
      {[-14, -7, 0, 7, 14].map((offset) => (
        <span
          aria-hidden="true"
          className="light-overlay__ray"
          key={offset}
          style={{ '--ray-offset': `${offset}deg` } as CSSProperties}
        />
      ))}
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
  anchor,
  onAnchorChange,
}: {
  ratio: string;
  scale: number;
  anchor: ExpandAnchor;
  onAnchorChange?: (anchor: ExpandAnchor) => void;
}) {
  const selected = expandAnchors.find((item) => item.id === anchor) ?? expandAnchors[4];
  const style = {
    '--expand-scale': `${Math.min(100, Math.max(36, scale))}%`,
    '--expand-x': `${selected.x}%`,
    '--expand-y': `${selected.y}%`,
    '--expand-shift-x': `${-selected.x}%`,
    '--expand-shift-y': `${-selected.y}%`,
  } as CSSProperties;

  return (
    <div
      aria-label="扩图构图区域"
      className="expand-overlay nodrag"
      data-overlay="expand"
      data-anchor={selected.id}
      data-ratio={ratio}
      data-scale={scale}
      style={style}
    >
      <span aria-hidden="true" className="expand-overlay__original" />
      <div aria-label="扩图范围网格" className="expand-overlay__grid">
        {expandAnchors.map((item) => (
          <button
            aria-label={`扩图锚点 ${item.label}`}
            aria-pressed={item.id === selected.id}
            key={item.id}
            onClick={() => onAnchorChange?.(item.id)}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

export type ExpandAnchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

const expandAnchors: Array<{ id: ExpandAnchor; label: string; x: number; y: number }> = [
  { id: 'top-left', label: '左上', x: 0, y: 0 },
  { id: 'top', label: '上方', x: 50, y: 0 },
  { id: 'top-right', label: '右上', x: 100, y: 0 },
  { id: 'left', label: '左侧', x: 0, y: 50 },
  { id: 'center', label: '居中', x: 50, y: 50 },
  { id: 'right', label: '右侧', x: 100, y: 50 },
  { id: 'bottom-left', label: '左下', x: 0, y: 100 },
  { id: 'bottom', label: '下方', x: 50, y: 100 },
  { id: 'bottom-right', label: '右下', x: 100, y: 100 },
];

export function RemoveMaskOverlay({
  brushSize,
  maskImageUrl,
  onMaskChange,
}: {
  brushSize: number;
  maskImageUrl?: string;
  onMaskChange?: (maskImageUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [sourceSize, setSourceSize] = useState({ width: 1024, height: 1024 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const sourceImage = canvas?.closest('.canvas-node')?.querySelector<HTMLImageElement>(':scope > img');
    if (!sourceImage) return;
    const syncSize = () => {
      if (sourceImage.naturalWidth > 0 && sourceImage.naturalHeight > 0) {
        setSourceSize({ width: sourceImage.naturalWidth, height: sourceImage.naturalHeight });
      }
    };
    syncSize();
    sourceImage.addEventListener('load', syncSize);
    return () => sourceImage.removeEventListener('load', syncSize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!maskImageUrl) return;
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = maskImageUrl;
  }, [maskImageUrl, sourceSize.height, sourceSize.width]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height,
    };
  };

  const drawTo = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    const point = pointFromEvent(event);
    if (!context || !point) return;
    const previous = lastPointRef.current ?? point;
    context.strokeStyle = '#ffffff';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(8, brushSize) * 4;
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  };

  return (
    <div aria-label="去除蒙版编辑" className="remove-mask-overlay nodrag" data-overlay="remove">
      <canvas
        aria-label="去除蒙版画布"
        height={sourceSize.height}
        onPointerDown={(event) => {
          event.stopPropagation();
          drawingRef.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          lastPointRef.current = pointFromEvent(event);
          drawTo(event);
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          event.stopPropagation();
          drawTo(event);
        }}
        onPointerUp={(event) => {
          if (!drawingRef.current) return;
          event.stopPropagation();
          drawTo(event);
          drawingRef.current = false;
          lastPointRef.current = null;
          onMaskChange?.(event.currentTarget.toDataURL('image/png'));
        }}
        ref={canvasRef}
        width={sourceSize.width}
      />
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
    '--angle-elevation': `${Math.max(-1, Math.min(1, vertical)) * 34}%`,
  } as CSSProperties;

  return (
    <div
      aria-label="视角预览"
      className="angle-preview nodrag"
      data-overlay="angle"
      data-horizontal={horizontal}
      data-vertical={vertical}
      style={style}
    >
      <span className="angle-preview__orbit" />
      <span className="angle-preview__camera" />
    </div>
  );
}
