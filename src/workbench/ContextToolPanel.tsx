import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getProfile, type Asset, type TaskParameters, type TaskProfileId } from '../domain';

type ContextToolPanelProps = {
  tool: TaskProfileId;
  prompt: string;
  outputCount: number;
  ratio: string;
  availableCredits: number;
  assets: Asset[];
  parameters: TaskParameters;
  referenceAssetId: string;
  onPromptChange: (prompt: string) => void;
  onOutputCountChange: (count: number) => void;
  onRatioChange: (ratio: string) => void;
  onParameterChange: (key: string, value: string | number) => void;
  onReferenceAssetChange: (assetId: string) => void;
  onClose: () => void;
  onRun: () => void;
};

export function ContextToolPanel(props: ContextToolPanelProps) {
  const profile = getProfile(props.tool);
  const estimate = profile.costPerOutput * props.outputCount;
  const cannotRun = !props.prompt.trim()
    || estimate > props.availableCredits
    || (props.tool === 'blend' && !props.referenceAssetId);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  return (
    <section
      aria-label={`${profile.label}参数`}
      className="context-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onClose();
        }
      }}
      role="dialog"
    >
      <header>
        <strong>{profile.label}</strong>
        <button aria-label="关闭参数面板" onClick={props.onClose} title="关闭参数面板" type="button">
          <X size={17} />
        </button>
      </header>
      <label>
        <span>创作描述</span>
        <textarea
          aria-label="创作描述"
          onChange={(event) => props.onPromptChange(event.target.value)}
          ref={promptRef}
          value={props.prompt}
        />
      </label>
      <fieldset className="segmented">
        <legend>输出数量</legend>
        {[1, 2, 4].map((count) => (
          <button
            aria-pressed={count === props.outputCount}
            className={count === props.outputCount ? 'is-active' : ''}
            key={count}
            onClick={() => props.onOutputCountChange(count)}
            type="button"
          >
            {count}
          </button>
        ))}
      </fieldset>
      <label>
        <span>画面比例</span>
        <select
          aria-label="画面比例"
          onChange={(event) => props.onRatioChange(event.target.value)}
          value={props.ratio}
        >
          <option value="1:1">1:1</option>
          <option value="4:5">4:5</option>
          <option value="16:9">16:9</option>
        </select>
      </label>
      {props.tool === 'blend' && (
        <label>
          <span>参考素材</span>
          <select
            aria-label="参考素材"
            onChange={(event) => props.onReferenceAssetChange(event.target.value)}
            value={props.referenceAssetId}
          >
            <option value="">请选择参考素材</option>
            {props.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.product} · {asset.skuCode}</option>
            ))}
          </select>
        </label>
      )}
      <ToolSpecificControl
        onParameterChange={props.onParameterChange}
        parameters={props.parameters}
        tool={props.tool}
      />
      <div className="credit-estimate">
        <span>预计消耗</span>
        <strong>{estimate} 点</strong>
      </div>
      {estimate > props.availableCredits && <p role="alert">可用额度不足</p>}
      <button className="primary-action" disabled={cannotRun} onClick={props.onRun} type="button">
        开始生成
      </button>
    </section>
  );
}

function ToolSpecificControl({
  tool,
  parameters,
  onParameterChange,
}: {
  tool: TaskProfileId;
  parameters: TaskParameters;
  onParameterChange: (key: string, value: string | number) => void;
}) {

  if (tool === 'light') {
    return (
      <label>
        <span>光线强度</span>
        <input
          aria-label="光线强度"
          max="100"
          min="0"
          onChange={(event) => onParameterChange('lightIntensity', Number(event.target.value))}
          type="range"
          value={parameters.lightIntensity ?? 60}
        />
      </label>
    );
  }

  if (tool === 'blend') {
    return (
      <label>
        <span>融合强度</span>
        <input
          aria-label="融合强度"
          max="100"
          min="0"
          onChange={(event) => onParameterChange('blendStrength', Number(event.target.value))}
          type="range"
          value={parameters.blendStrength ?? 50}
        />
      </label>
    );
  }

  if (tool === 'angle') {
    return (
      <SegmentedOptions
        label="视角"
        onChange={(value) => onParameterChange('angle', value)}
        options={['正面', '侧面', '俯视']}
        value={String(parameters.angle ?? '正面')}
      />
    );
  }

  if (tool === 'expand') {
    return (
      <SegmentedOptions
        label="扩图方向"
        onChange={(value) => onParameterChange('expandDirection', value)}
        options={['四周', '横向', '纵向']}
        value={String(parameters.expandDirection ?? '四周')}
      />
    );
  }

  return null;
}

function SegmentedOptions({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      {options.map((option) => (
        <button
          aria-pressed={option === value}
          className={option === value ? 'is-active' : ''}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}
