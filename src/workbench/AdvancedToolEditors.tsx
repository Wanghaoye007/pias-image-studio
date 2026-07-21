import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Lightbulb,
} from 'lucide-react';
import {
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TaskParameters } from '../domain';
import {
  clampFalHorizontalAngle,
  FAL_HORIZONTAL_ANGLE_MAX,
  FAL_HORIZONTAL_ANGLE_MIN,
} from '../fal/multipleAngles';

type ParameterChange = (key: string, value: string | number | boolean) => void;

type EditorProps = {
  previewImageUrl: string;
  parameters: TaskParameters;
  onParameterChange: ParameterChange;
};

const lightSources = [
  { label: '左侧', value: 'left', x: 12, y: 50 },
  { label: '顶部', value: 'top', x: 50, y: 10 },
  { label: '右侧', value: 'right', x: 88, y: 50 },
  { label: '前方', value: 'front', x: 30, y: 30 },
  { label: '底部', value: 'bottom', x: 50, y: 90 },
  { label: '后方', value: 'back', x: 70, y: 30 },
] as const;

const anglePresets = [
  { label: '自定义', value: 'custom', parameters: {} },
  { label: '鱼眼视角', value: 'fisheye', parameters: { horizontalAngle: 0, verticalView: 0, moveForward: 0, wideAngle: true } },
  { label: '倾斜视角', value: 'tilted', parameters: { horizontalAngle: 45, verticalView: 0.3, moveForward: 2, wideAngle: false } },
  { label: '正面俯拍', value: 'front-high', parameters: { horizontalAngle: 0, verticalView: -0.8, moveForward: 2, wideAngle: false } },
  { label: '正面仰拍', value: 'front-low', parameters: { horizontalAngle: 0, verticalView: 0.8, moveForward: 2, wideAngle: false } },
  { label: '全景俯拍', value: 'wide-high', parameters: { horizontalAngle: 0, verticalView: -0.7, moveForward: 0, wideAngle: true } },
  { label: '侧面视角', value: 'side', parameters: { horizontalAngle: 90, verticalView: 0, moveForward: 1, wideAngle: false } },
] as const;

export function LightEditor({ previewImageUrl, parameters, onParameterChange }: EditorProps) {
  const [view, setView] = useState<'perspective' | 'front'>('perspective');
  const direction = normalizeLightDirection(String(parameters.lightDirection ?? 'front'));
  const source = lightSources.find((item) => item.value === direction) ?? lightSources[3];
  const beamAngle = Math.atan2(50 - source.y, 50 - source.x) * 180 / Math.PI;
  const beamLength = Math.hypot(50 - source.x, 50 - source.y) * 1.18;
  const sphereStyle = {
    '--source-x': `${source.x}%`,
    '--source-y': `${source.y}%`,
    '--beam-angle': `${beamAngle}deg`,
    '--beam-length': `${beamLength}%`,
  } as CSSProperties;

  const updateFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    let nextDirection = 'front';
    if (x < 0.28) nextDirection = 'left';
    else if (x > 0.72) nextDirection = 'right';
    else if (y < 0.3) nextDirection = 'top';
    else if (y > 0.7) nextDirection = 'bottom';
    onParameterChange('lightDirection', nextDirection);
  };

  return (
    <div className="advanced-editor advanced-editor--light">
      <div className="advanced-editor__viewport">
        <div aria-label="灯光视图" className="editor-view-tabs" role="tablist">
          <button
            aria-selected={view === 'perspective'}
            onClick={() => setView('perspective')}
            role="tab"
            type="button"
          >
            透视
          </button>
          <button
            aria-selected={view === 'front'}
            onClick={() => setView('front')}
            role="tab"
            type="button"
          >
            正面
          </button>
        </div>
        <div className="light-sphere" data-view={view} style={sphereStyle}>
          <span aria-hidden="true" className="editor-sphere__latitude editor-sphere__latitude--one" />
          <span aria-hidden="true" className="editor-sphere__latitude editor-sphere__latitude--two" />
          <span aria-hidden="true" className="editor-sphere__meridian editor-sphere__meridian--one" />
          <span aria-hidden="true" className="editor-sphere__meridian editor-sphere__meridian--two" />
          <button
            aria-label="拖动主光源"
            className="light-sphere__surface"
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
          <span aria-hidden="true" className="light-sphere__beam" />
          <img alt="当前打光素材" className="editor-sphere__image" src={previewImageUrl} />
          {lightSources.map((item) => (
            <button
              aria-label={`主光源 ${item.label}`}
              aria-pressed={direction === item.value}
              className="light-sphere__source"
              key={item.value}
              onClick={(event) => {
                event.stopPropagation();
                onParameterChange('lightDirection', item.value);
              }}
              style={{ left: `${item.x}%`, top: `${item.y}%` }}
              title={item.label}
              type="button"
            >
              <Lightbulb aria-hidden="true" size={13} />
            </button>
          ))}
        </div>
      </div>

      <div className="advanced-editor__controls light-editor-controls">
        <div className="editor-section-heading">
          <strong>全局</strong>
          <SwitchControl
            checked={Boolean(parameters.lightSmartMode)}
            label="智能模式"
            onChange={(value) => onParameterChange('lightSmartMode', value)}
          />
        </div>
        <EditorRange
          ariaLabel="光线强度"
          label="亮度"
          onChange={(value) => onParameterChange('lightIntensity', value)}
          suffix="%"
          value={numberValue(parameters.lightIntensity, 50)}
        />
        <TemperatureControl
          onChange={(value) => onParameterChange('lightTemperature', value)}
          value={numberValue(parameters.lightTemperature, 5200)}
        />
        <fieldset className="light-source-grid">
          <legend>主光源</legend>
          {lightSources.map((item) => (
            <button
              aria-pressed={direction === item.value}
              key={item.value}
              onClick={() => onParameterChange('lightDirection', item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <SwitchControl
          checked={Boolean(parameters.rimLight)}
          help
          label="轮廓光"
          onChange={(value) => onParameterChange('rimLight', value)}
        />
      </div>
    </div>
  );
}

export function AngleEditor({ previewImageUrl, parameters, onParameterChange }: EditorProps) {
  const [preset, setPreset] = useState('custom');
  const horizontal = clampFalHorizontalAngle(numberValue(parameters.horizontalAngle, -45));
  const vertical = numberValue(parameters.verticalView, -0.7);
  const moveForward = numberValue(parameters.moveForward, 0);
  const radians = horizontal * Math.PI / 180;
  const cameraX = 50 - Math.sin(radians) * 38 * Math.cos(vertical * Math.PI / 6);
  const cameraY = clamp(50 + Math.cos(radians) * 25 + vertical * 42, 10, 90);
  const facingAngle = Math.atan2(50 - cameraY, 50 - cameraX) * 180 / Math.PI;
  const cameraDistance = Math.hypot(50 - cameraX, 50 - cameraY);
  const angleStyle = {
    '--editor-camera-x': `${cameraX}%`,
    '--editor-camera-y': `${cameraY}%`,
    '--editor-camera-angle': `${facingAngle}deg`,
    '--editor-camera-distance': `${cameraDistance}%`,
  } as CSSProperties;

  const changeParameter = (key: string, value: string | number | boolean) => {
    setPreset('custom');
    onParameterChange(
      key,
      key === 'horizontalAngle' && typeof value === 'number'
        ? clampFalHorizontalAngle(value)
        : value,
    );
  };

  const updateFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    changeParameter('horizontalAngle', Math.round(Math.atan2(-x, y) * 180 / Math.PI));
  };

  return (
    <div className="angle-editor-shell">
      <div aria-label="视角预设" className="angle-editor-presets" role="tablist">
        {anglePresets.map((item) => (
          <button
            aria-selected={preset === item.value}
            key={item.value}
            onClick={() => {
              setPreset(item.value);
              Object.entries(item.parameters).forEach(([key, value]) => onParameterChange(key, value));
            }}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="advanced-editor advanced-editor--angle">
        <div className="advanced-editor__viewport angle-sphere-viewport">
          <div className="angle-sphere" style={angleStyle}>
            <span aria-hidden="true" className="editor-sphere__latitude editor-sphere__latitude--one" />
            <span aria-hidden="true" className="editor-sphere__latitude editor-sphere__latitude--two" />
            <span aria-hidden="true" className="editor-sphere__latitude editor-sphere__latitude--three" />
            <span aria-hidden="true" className="editor-sphere__meridian editor-sphere__meridian--one" />
            <span aria-hidden="true" className="editor-sphere__meridian editor-sphere__meridian--two" />
            <span aria-hidden="true" className="editor-sphere__meridian editor-sphere__meridian--three" />
            <button
              aria-label="拖动摄像机机位"
              className="angle-sphere__surface"
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
            <span aria-hidden="true" className="angle-sphere__sightline" />
            <img alt="当前多角度素材" className="editor-sphere__image" src={previewImageUrl} />
            <span aria-hidden="true" className="angle-sphere__camera">
              <Camera size={18} strokeWidth={1.8} />
            </span>
          </div>
          <AngleNudge
            icon={ChevronUp}
            label="向上调整机位"
            onClick={() => changeParameter('verticalView', clamp(vertical - 0.1, -1, 1))}
            position="top"
          />
          <AngleNudge
            icon={ChevronRight}
            label="向右环绕机位"
            onClick={() => changeParameter('horizontalAngle', horizontal - 15)}
            position="right"
          />
          <AngleNudge
            icon={ChevronDown}
            label="向下调整机位"
            onClick={() => changeParameter('verticalView', clamp(vertical + 0.1, -1, 1))}
            position="bottom"
          />
          <AngleNudge
            icon={ChevronLeft}
            label="向左环绕机位"
            onClick={() => changeParameter('horizontalAngle', horizontal + 15)}
            position="left"
          />
        </div>

        <div className="advanced-editor__controls angle-editor-controls">
          <EditorRange
            ariaLabel="水平旋转"
            formatValue={formatHorizontalAngle}
            label="水平环绕"
            max={FAL_HORIZONTAL_ANGLE_MAX}
            min={FAL_HORIZONTAL_ANGLE_MIN}
            onChange={(value) => changeParameter('horizontalAngle', value)}
            value={horizontal}
          />
          <EditorRange
            ariaLabel="垂直视角"
            formatValue={formatVerticalAngle}
            label="垂直俯仰"
            max={1}
            min={-1}
            onChange={(value) => changeParameter('verticalView', value)}
            step={0.1}
            value={vertical}
          />
          <EditorRange
            ariaLabel="镜头推进"
            formatValue={shotScaleLabel}
            label="景别缩放"
            max={10}
            min={0}
            onChange={(value) => changeParameter('moveForward', value)}
            value={moveForward}
          />
          <SwitchControl
            checked={Boolean(parameters.wideAngle)}
            label="广角镜头"
            onChange={(value) => changeParameter('wideAngle', value)}
          />
          <p className="angle-editor-risk" role="note">模型会推断不可见区域，结果需人工复核</p>
        </div>
      </div>
    </div>
  );
}

function EditorRange({
  label,
  ariaLabel,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
  formatValue,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  formatValue?: (value: number) => string;
}) {
  const progress = (value - min) / (max - min) * 100;
  return (
    <label className="editor-range">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={{ '--range-progress': `${progress}%` } as CSSProperties}
        type="range"
        value={value}
      />
      <output>{formatValue ? formatValue(value) : `${value}${suffix}`}</output>
    </label>
  );
}

function TemperatureControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const presets = [
    { label: '暖光', value: 3200 },
    { label: '中性光', value: 5200 },
    { label: '冷光', value: 7000 },
  ];
  return (
    <div className="temperature-control">
      <span>颜色 <CircleHelp aria-hidden="true" size={13} /></span>
      <div>
        {presets.map((preset) => (
          <button
            aria-label={`${preset.label} ${preset.value}K`}
            aria-pressed={Math.abs(value - preset.value) < 900}
            key={preset.value}
            onClick={() => onChange(preset.value)}
            style={{ '--temperature': preset.value } as CSSProperties}
            type="button"
          />
        ))}
      </div>
      <input
        aria-label="色温"
        max={7500}
        min={2800}
        onChange={(event) => onChange(Number(event.target.value))}
        step={100}
        type="range"
        value={value}
      />
      <output>{value}K</output>
    </div>
  );
}

function SwitchControl({
  label,
  checked,
  onChange,
  help = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  help?: boolean;
}) {
  return (
    <label className="editor-switch">
      <span>{label}{help && <CircleHelp aria-hidden="true" size={13} />}</span>
      <input aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function AngleNudge({
  icon: Icon,
  label,
  onClick,
  position,
}: {
  icon: typeof ChevronUp;
  label: string;
  onClick: () => void;
  position: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <button
      aria-label={label}
      className={`angle-nudge angle-nudge--${position}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={19} />
    </button>
  );
}

function normalizeLightDirection(value: string): typeof lightSources[number]['value'] {
  if (value === 'top-left' || value === 'top') return 'top';
  if (value === 'top-right' || value === 'right') return 'right';
  if (value === 'bottom-right' || value === 'back') return 'back';
  if (value === 'bottom') return 'bottom';
  if (value === 'bottom-left' || value === 'front') return 'front';
  return 'left';
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function shotScaleLabel(value: number): string {
  if (value <= 2) return '全景';
  if (value <= 6) return '中景';
  return '近景';
}

function formatHorizontalAngle(value: number): string {
  if (value === 0) return '正面';
  return `${value > 0 ? '左' : '右'} ${Math.abs(value)}°`;
}

function formatVerticalAngle(value: number): string {
  if (value === 0) return '水平';
  return `${value < 0 ? '俯' : '仰'} ${Math.round(Math.abs(value) * 45 + 0.000001)}°`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(1))));
}
