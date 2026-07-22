import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Camera } from 'lucide-react';
import { clampFalHorizontalAngle } from '../../shared/fal/multipleAngles';

export type LightDirection =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | 'front'
  | 'back';

const lightDirections: Array<{
  id: LightDirection;
  label: string;
  shortLabel: string;
  x: number;
  y: number;
}> = [
  { id: 'top-left', label: '左上光', shortLabel: '↘', x: 16, y: 16 },
  { id: 'top', label: '上方光', shortLabel: '↓', x: 50, y: 10 },
  { id: 'top-right', label: '右上光', shortLabel: '↙', x: 84, y: 16 },
  { id: 'right', label: '右侧光', shortLabel: '←', x: 78, y: 50 },
  { id: 'bottom-right', label: '右下光', shortLabel: '↖', x: 84, y: 84 },
  { id: 'bottom', label: '下方光', shortLabel: '↑', x: 50, y: 90 },
  { id: 'bottom-left', label: '左下光', shortLabel: '↗', x: 16, y: 84 },
  { id: 'left', label: '左侧光', shortLabel: '→', x: 14, y: 50 },
  { id: 'front', label: '前方光', shortLabel: '●', x: 50, y: 68 },
  { id: 'back', label: '后方光', shortLabel: '○', x: 50, y: 32 },
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
      {lightDirections.filter((item) => item.id !== 'front' && item.id !== 'back').map((item) => (
        <button
          aria-label={`定向光控制柄 ${item.label}`}
          aria-pressed={item.id === direction}
          className="light-overlay__handle"
          data-position={item.id}
          key={item.id}
          onClick={(event) => {
            event.stopPropagation();
            onDirectionChange?.(item.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ left: `${item.x}%`, top: `${item.y}%` }}
          title={`设为${item.label}`}
          type="button"
        >
          <span aria-hidden="true">{item.shortLabel}</span>
        </button>
      ))}
      <button
        aria-label="定向光控制点"
        className="light-overlay__point"
        data-direction={direction}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            event.stopPropagation();
            updateFromPointer(event);
          }
        }}
        type="button"
      />
      <output aria-live="polite" className="light-overlay__readout">
        <span aria-hidden="true">{selected.shortLabel}</span>
        {selected.label}
      </output>
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
  onHorizontalChange,
}: {
  horizontal: number;
  vertical: number;
  onHorizontalChange?: (horizontal: number) => void;
}) {
  const normalizedHorizontal = clampFalHorizontalAngle(horizontal);
  const normalizedVertical = Math.max(-1, Math.min(1, vertical));
  const radians = normalizedHorizontal * Math.PI / 180;
  const cameraX = 50 - Math.sin(radians) * 27;
  const cameraY = Math.max(10, Math.min(90, 50 + Math.cos(radians) * 28 + normalizedVertical * 9));
  const sightAngle = Math.atan2(cameraY - 50, cameraX - 50) * 180 / Math.PI;
  const sightLength = Math.hypot(cameraX - 50, cameraY - 50);
  const verticalDegrees = Math.round(normalizedVertical * 45);
  const style = {
    '--camera-x': `${cameraX}%`,
    '--camera-y': `${cameraY}%`,
    '--sight-angle': `${sightAngle}deg`,
    '--sight-length': `${sightLength}%`,
  } as CSSProperties;

  const updateFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    onHorizontalChange?.(clampFalHorizontalAngle(Math.round(Math.atan2(-dx, dy) * 180 / Math.PI)));
  };

  const cameraLabel = getCameraPositionLabel(normalizedHorizontal);
  const verticalLabel = verticalDegrees === 0
    ? '平视 0°'
    : `${verticalDegrees > 0 ? '仰视' : '俯视'} ${Math.abs(verticalDegrees)}°`;

  return (
    <div
      aria-label="视角预览"
      className="angle-preview nodrag"
      data-overlay="angle"
      data-horizontal={normalizedHorizontal}
      data-vertical={normalizedVertical}
      style={style}
    >
      <button
        aria-label="拖动调整拍摄方位"
        className="angle-preview__orbit-hit"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateFromPointer(event);
        }}
        type="button"
      />
      <span aria-hidden="true" className="angle-preview__orbit" />
      <span aria-hidden="true" className="angle-preview__sightline" />
      {anglePresets.map((preset) => {
        const presetRadians = preset * Math.PI / 180;
        const x = 50 - Math.sin(presetRadians) * 27;
        const y = 50 + Math.cos(presetRadians) * 28;
        return (
          <button
            aria-label={`设置拍摄方位 ${preset}°`}
            aria-pressed={normalizedHorizontal === preset}
            className="angle-preview__preset"
            key={preset}
            onClick={(event) => {
              event.stopPropagation();
              onHorizontalChange?.(preset);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ left: `${x}%`, top: `${y}%` }}
            title={`${getCameraPositionLabel(preset)} ${preset}°`}
            type="button"
          />
        );
      })}
      <span aria-hidden="true" className="angle-preview__axis angle-preview__axis--front">正面</span>
      <span aria-hidden="true" className="angle-preview__axis angle-preview__axis--right">右侧</span>
      <span aria-hidden="true" className="angle-preview__axis angle-preview__axis--left">左侧</span>
      <span aria-hidden="true" className="angle-preview__camera">
        <Camera size={16} strokeWidth={2} />
      </span>
      <output aria-live="polite" className="angle-preview__readout">
        <Camera aria-hidden="true" size={14} />
        <strong>{cameraLabel} {normalizedHorizontal}°</strong>
        <span>{verticalLabel}</span>
      </output>
    </div>
  );
}

const anglePresets = [-90, -45, 0, 45, 90];

function getCameraPositionLabel(horizontal: number): string {
  const absolute = Math.abs(horizontal);
  if (absolute <= 22) return '正面';
  if (horizontal > 0) return absolute < 68 ? '左前侧' : '左侧';
  return absolute < 68 ? '右前侧' : '右侧';
}
