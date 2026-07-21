import { ArrowUp, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getProfile, type Asset, type TaskParameters, type TaskProfileId } from '../domain';
import { AngleEditor, LightEditor } from './AdvancedToolEditors';

type ContextToolPanelProps = {
  tool: TaskProfileId;
  prompt: string;
  outputCount: number;
  ratio: string;
  availableCredits: number;
  assets: Asset[];
  parameters: TaskParameters;
  referenceAssetId: string;
  previewImageUrl: string;
  hasRemoveMask?: boolean;
  assetPickerOpen?: boolean;
  isSubmitting?: boolean;
  placement?: 'left' | 'right';
  onPromptChange: (prompt: string) => void;
  onOutputCountChange: (count: number) => void;
  onRatioChange: (ratio: string) => void;
  onParameterChange: (key: string, value: string | number | boolean) => void;
  onClearRemoveMask?: () => void;
  onReferenceAssetChange: (assetId: string) => void;
  onAssetPickerOpen?: () => void;
  onAssetPickerClose?: () => void;
  onClose: () => void;
  onRun: () => void;
};

const lightDirections = [
  { label: '左上光', value: 'top-left' },
  { label: '上方光', value: 'top' },
  { label: '右上光', value: 'top-right' },
  { label: '左侧光', value: 'left' },
  { label: '右侧光', value: 'right' },
  { label: '左下光', value: 'bottom-left' },
  { label: '下方光', value: 'bottom' },
  { label: '右下光', value: 'bottom-right' },
];

export function ContextToolPanel(props: ContextToolPanelProps) {
  const profile = getProfile(props.tool);
  const isAdvancedEditor = props.tool === 'light' || props.tool === 'angle';
  const estimate = profile.costPerOutput * props.outputCount;
  const cannotRun = props.isSubmitting
    || (props.tool === 'remove' && !props.hasRemoveMask)
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
      data-placement={props.placement ?? 'right'}
      data-tool={props.tool}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (props.assetPickerOpen) props.onAssetPickerClose?.();
        else props.onClose();
      }}
      role="dialog"
    >
      <header>
        <div>
          {!isAdvancedEditor && <small>图片处理</small>}
          <strong>{props.tool === 'light' ? '打光效果' : props.tool === 'angle' ? '多角度编辑器' : profile.label}</strong>
        </div>
        <button aria-label="关闭参数面板" onClick={props.onClose} title="关闭参数面板" type="button">
          <X size={17} />
        </button>
      </header>

      {props.tool === 'light' && (
        <>
          <LightEditor
            onParameterChange={props.onParameterChange}
            parameters={props.parameters}
            previewImageUrl={props.previewImageUrl}
          />
          <AdvancedEditorFooter
            estimate={estimate}
            onOutputCountChange={props.onOutputCountChange}
            onParameterChange={props.onParameterChange}
            onPromptChange={props.onPromptChange}
            onRatioChange={props.onRatioChange}
            onRun={props.onRun}
            outputCount={props.outputCount}
            ratio={props.ratio}
            disabled={cannotRun}
            submitting={Boolean(props.isSubmitting)}
            tool="light"
          />
        </>
      )}

      {props.tool === 'angle' && (
        <>
          <AngleEditor
            onParameterChange={props.onParameterChange}
            parameters={props.parameters}
            previewImageUrl={props.previewImageUrl}
          />
          <AdvancedEditorFooter
            estimate={estimate}
            onOutputCountChange={props.onOutputCountChange}
            onParameterChange={props.onParameterChange}
            onPromptChange={props.onPromptChange}
            onRatioChange={props.onRatioChange}
            onRun={props.onRun}
            outputCount={props.outputCount}
            ratio={props.ratio}
            disabled={cannotRun}
            submitting={Boolean(props.isSubmitting)}
            tool="angle"
          />
        </>
      )}

      {!isAdvancedEditor && <>{props.tool === 'blend' && (
        <ReferenceAssetSlot
          asset={props.assets.find((asset) => asset.id === props.referenceAssetId)}
          onOpen={() => props.onAssetPickerOpen?.()}
        />
      )}

      <ToolSpecificControls
        onParameterChange={props.onParameterChange}
        parameters={props.parameters}
        tool={props.tool}
      />

      {props.tool === 'remove' && (
        <div className="remove-mask-status" data-ready={props.hasRemoveMask ? 'true' : 'false'}>
          <span>{props.hasRemoveMask ? '蒙版已就绪' : '在图片上涂抹要移除的区域'}</span>
          {props.hasRemoveMask && (
            <button
              aria-label="清除去除蒙版"
              onClick={props.onClearRemoveMask}
              title="清除蒙版"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={15} />
            </button>
          )}
        </div>
      )}

      {['generate', 'blend', 'light', 'expand'].includes(props.tool) && (
        <label className="context-panel__field">
          <span>补充描述（可选）</span>
          <textarea
            aria-label="创作描述"
            onChange={(event) => props.onPromptChange(event.target.value)}
            placeholder={promptPlaceholder(props.tool)}
            ref={promptRef}
            value={props.prompt}
          />
        </label>
      )}

      {props.tool === 'angle' && (
        <p className="angle-risk" role="note">模型会推断不可见区域，结果需人工复核</p>
      )}

      {props.tool === 'light' && (
        <p className="angle-risk" role="note">实验能力：生成后请重点复核商品文字、颜色与材质</p>
      )}

      {!['remove', 'extract', 'upscale'].includes(props.tool) && (
        <fieldset className="segmented segmented--counts">
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
      )}

      {['generate', 'blend', 'angle', 'expand'].includes(props.tool) && (
        <label className="context-panel__field context-panel__field--inline">
          <span>画面比例</span>
          <select
            aria-label="画面比例"
            onChange={(event) => props.onRatioChange(event.target.value)}
            value={props.ratio}
          >
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="3:4">3:4</option>
            <option value="4:3">4:3</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </label>
      )}

      <footer className="context-panel__footer">
        <div className="credit-estimate">
          <span>预计消耗</span>
          <strong>{estimate} 点</strong>
        </div>
        {estimate > props.availableCredits && <p role="alert">可用额度不足</p>}
        <button
          aria-label="开始生成"
          className="primary-action"
          disabled={cannotRun}
          onClick={props.onRun}
          type="button"
        >
          {props.isSubmitting ? '正在提交' : actionLabel(props.tool)}
        </button>
      </footer>

      {props.assetPickerOpen && (
        <AssetPicker
          assets={props.assets}
          onClose={() => props.onAssetPickerClose?.()}
          onSelect={(assetId) => {
            props.onReferenceAssetChange(assetId);
            props.onAssetPickerClose?.();
          }}
          selectedAssetId={props.referenceAssetId}
        />
      )}</>}
    </section>
  );
}

function AdvancedEditorFooter({
  tool,
  outputCount,
  ratio,
  estimate,
  disabled,
  submitting,
  onOutputCountChange,
  onRatioChange,
  onParameterChange,
  onPromptChange,
  onRun,
}: {
  tool: 'light' | 'angle';
  outputCount: number;
  ratio: string;
  estimate: number;
  disabled: boolean;
  submitting: boolean;
  onOutputCountChange: (count: number) => void;
  onRatioChange: (ratio: string) => void;
  onParameterChange: (key: string, value: string | number | boolean) => void;
  onPromptChange: (prompt: string) => void;
  onRun: () => void;
}) {
  const reset = () => {
    if (tool === 'light') {
      onParameterChange('lightDirection', 'front');
      onParameterChange('lightIntensity', 50);
      onParameterChange('lightTemperature', 5200);
      onParameterChange('lightSmartMode', false);
      onParameterChange('rimLight', false);
    } else {
      onParameterChange('horizontalAngle', -45);
      onParameterChange('moveForward', 0);
      onParameterChange('verticalView', -0.7);
      onParameterChange('wideAngle', false);
    }
    onPromptChange('');
  };

  return (
    <footer className="advanced-editor-footer">
      <button className="advanced-editor-footer__reset" onClick={reset} type="button">
        <RotateCcw aria-hidden="true" size={17} />
        <span>重置参数</span>
      </button>
      <div aria-label="输出数量" className="advanced-editor-footer__count" role="group">
        <span>输出</span>
        {[1, 2, 4].map((count) => (
          <button
            aria-pressed={count === outputCount}
            key={count}
            onClick={() => onOutputCountChange(count)}
            type="button"
          >
            {count}
          </button>
        ))}
      </div>
      {tool === 'angle' && (
        <label className="advanced-editor-footer__ratio">
          <span>比例</span>
          <select aria-label="画面比例" onChange={(event) => onRatioChange(event.target.value)} value={ratio}>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="3:4">3:4</option>
            <option value="4:3">4:3</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </label>
      )}
      <span className="advanced-editor-footer__credit">预计 {estimate} 点</span>
      <button
        aria-label="开始生成"
        className="advanced-editor-footer__run"
        disabled={disabled}
        onClick={onRun}
        type="button"
      >
        <span>{submitting ? '提交中' : tool === 'light' ? '生成打光' : '生成视角'}</span>
        <ArrowUp aria-hidden="true" size={19} strokeWidth={2.2} />
      </button>
    </footer>
  );
}

function ReferenceAssetSlot({ asset, onOpen }: { asset?: Asset; onOpen: () => void }) {
  return (
    <div className="reference-slot">
      <span>参考素材</span>
      <button aria-label="选择参考素材" onClick={onOpen} type="button">
        {asset ? (
          <>
            <img alt="" src={asset.imageUrl} />
            <span>
              <strong>{asset.product}</strong>
              <small>{asset.skuCode}</small>
            </span>
          </>
        ) : (
          <span>选择商品或场景参考</span>
        )}
      </button>
    </div>
  );
}

function AssetPicker({
  assets,
  selectedAssetId,
  onSelect,
  onClose,
}: {
  assets: Asset[];
  selectedAssetId: string;
  onSelect: (assetId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return assets;
    return assets.filter((asset) => [asset.product, asset.skuCode, asset.usage]
      .some((value) => value.toLocaleLowerCase('zh-CN').includes(normalized)));
  }, [assets, query]);

  return (
    <section aria-label="选择参考素材" className="asset-picker" role="dialog">
      <header>
        <strong>选择参考素材</strong>
        <button aria-label="关闭素材选择" onClick={onClose} type="button"><X size={16} /></button>
      </header>
      <label className="asset-picker__search">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label="搜索参考素材"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索商品、SKU 或用途"
          type="search"
          value={query}
        />
      </label>
      <div className="asset-picker__grid">
        {filteredAssets.map((asset) => (
          <button
            aria-label={`${asset.product}，${asset.skuCode}，${asset.usage}`}
            aria-pressed={asset.id === selectedAssetId}
            className={asset.id === selectedAssetId ? 'is-selected' : ''}
            key={asset.id}
            onClick={() => onSelect(asset.id)}
            type="button"
          >
            <img alt="" src={asset.imageUrl} />
            <span>{asset.product}</span>
            <small>{asset.skuCode}</small>
          </button>
        ))}
        {filteredAssets.length === 0 && <p>暂无匹配素材</p>}
      </div>
    </section>
  );
}

function ToolSpecificControls({
  tool,
  parameters,
  onParameterChange,
}: {
  tool: TaskProfileId;
  parameters: TaskParameters;
  onParameterChange: (key: string, value: string | number | boolean) => void;
}) {
  if (tool === 'generate') {
    return (
      <>
        <SegmentedOptions
          label="场景模板"
          onChange={(value) => onParameterChange('sceneTemplate', value)}
          options={[
            { label: '日光展台', value: '日光展台' },
            { label: '水面倒影', value: '水面倒影' },
            { label: '纯净棚拍', value: '纯净棚拍' },
          ]}
          value={String(parameters.sceneTemplate ?? '日光展台')}
        />
        <SegmentedOptions
          label="质量"
          onChange={(value) => onParameterChange('quality', value)}
          options={[
            { label: '快速', value: '快速' },
            { label: '精细', value: '精细' },
          ]}
          value={String(parameters.quality ?? '精细')}
        />
      </>
    );
  }

  if (tool === 'blend') {
    return (
      <SegmentedOptions
        label="商品位置"
        onChange={(value) => onParameterChange('productPlacement', value)}
        options={[
          { label: '左侧', value: 'left_center' },
          { label: '居中', value: 'center_vertical' },
          { label: '右侧', value: 'right_center' },
          { label: '左下', value: 'bottom_left' },
          { label: '下方', value: 'bottom_center' },
          { label: '右下', value: 'bottom_right' },
        ]}
        value={String(parameters.productPlacement ?? 'bottom_center')}
      />
    );
  }

  if (tool === 'light') {
    return (
      <>
        <SegmentedOptions
          className="segmented--directions"
          label="光源方向"
          onChange={(value) => onParameterChange('lightDirection', value)}
          options={lightDirections}
          value={String(parameters.lightDirection ?? 'top-right')}
        />
        <RangeControl
          label="光线强度"
          onChange={(value) => onParameterChange('lightIntensity', value)}
          value={numberValue(parameters.lightIntensity, 60)}
        />
        <RangeControl
          label="色温"
          max={7500}
          min={2800}
          onChange={(value) => onParameterChange('lightTemperature', value)}
          step={100}
          suffix="K"
          value={numberValue(parameters.lightTemperature, 5200)}
        />
      </>
    );
  }

  if (tool === 'angle') {
    return (
      <>
        <RangeControl
          label="水平旋转"
          max={180}
          min={-180}
          onChange={(value) => onParameterChange('horizontalAngle', value)}
          suffix="°"
          value={numberValue(parameters.horizontalAngle, 0)}
        />
        <RangeControl
          label="镜头推进"
          max={10}
          min={0}
          onChange={(value) => onParameterChange('moveForward', value)}
          value={numberValue(parameters.moveForward, 0)}
        />
        <RangeControl
          label="垂直视角"
          max={1}
          min={-1}
          onChange={(value) => onParameterChange('verticalView', value)}
          step={0.1}
          value={numberValue(parameters.verticalView, 0)}
        />
        <BooleanControl
          checked={Boolean(parameters.wideAngle)}
          label="广角镜头"
          onChange={(value) => onParameterChange('wideAngle', value)}
        />
      </>
    );
  }

  if (tool === 'expand') {
    return (
      <>
        <SegmentedOptions
          className="segmented--anchors"
          label="原图锚点"
          onChange={(value) => onParameterChange('expandAnchor', value)}
          options={[
            { label: '左上', value: 'top-left' },
            { label: '上', value: 'top' },
            { label: '右上', value: 'top-right' },
            { label: '左', value: 'left' },
            { label: '中', value: 'center' },
            { label: '右', value: 'right' },
            { label: '左下', value: 'bottom-left' },
            { label: '下', value: 'bottom' },
            { label: '右下', value: 'bottom-right' },
          ]}
          value={String(parameters.expandAnchor ?? 'center')}
        />
        <RangeControl
          label="原图缩放"
          max={100}
          min={36}
          onChange={(value) => onParameterChange('expandScale', value)}
          suffix="%"
          value={numberValue(parameters.expandScale, 72)}
        />
      </>
    );
  }

  if (tool === 'upscale') {
    return (
      <>
        <SegmentedOptions
          label="目标尺寸"
          onChange={(value) => onParameterChange('upscaleSize', value)}
          options={[
            { label: '2K', value: '2048' },
            { label: '4K', value: '4096' },
            { label: '8K', value: '8192' },
          ]}
          value={String(parameters.upscaleSize ?? '2048')}
        />
        <RangeControl
          label="细节增强"
          onChange={(value) => onParameterChange('detailLevel', value)}
          value={numberValue(parameters.detailLevel, 60)}
        />
      </>
    );
  }

  if (tool === 'remove') {
    return (
      <RangeControl
        label="笔刷大小"
        onChange={(value) => onParameterChange('brushSize', value)}
        value={numberValue(parameters.brushSize, 42)}
      />
    );
  }

  return null;
}

function BooleanControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-control">
      <span>{label}</span>
      <input
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function SegmentedOptions({
  label,
  options,
  value,
  onChange,
  className = '',
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <fieldset className={`segmented ${className}`}>
      <legend>{label}</legend>
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className={option.value === value ? 'is-active' : ''}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

function RangeControl({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="range-control">
      <span>{label}<output>{value}{suffix}</output></span>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function promptPlaceholder(tool: TaskProfileId): string {
  if (tool === 'blend') return '例如：保留瓶身文字与材质';
  if (tool === 'light') return '例如：柔和商业棚拍光';
  return '可补充构图、材质或品牌要求';
}

function actionLabel(tool: TaskProfileId): string {
  if (tool === 'expand') return '开始扩图';
  if (tool === 'upscale') return '开始超分';
  if (tool === 'angle') return '生成视角';
  if (tool === 'light') return '生成打光';
  if (tool === 'blend') return '开始合成';
  if (tool === 'remove') return '开始移除';
  if (tool === 'extract') return '开始抠图';
  return '开始生成';
}
