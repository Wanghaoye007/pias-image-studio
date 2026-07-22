import { ChevronRight, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { taskProfiles, type TaskProfileId } from '../../shared/domain';
import { toolIcons } from './ToolPalette';

type NodeTypePickerProps = {
  activeTool?: TaskProfileId;
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (tool: TaskProfileId) => void;
};

const nodeOrder: TaskProfileId[] = [
  'generate',
  'blend',
  'angle',
  'light',
  'remove',
  'extract',
  'expand',
  'upscale',
];

const nodeDescriptions: Record<TaskProfileId, string> = {
  generate: '从当前素材生成新画面',
  blend: '融合参考图与主体素材',
  angle: '改变摄像机拍摄机位',
  light: '重塑画面的光照方向',
  remove: '擦除画面中的指定区域',
  extract: '分离主体并移除背景',
  expand: '延展画面与重新构图',
  upscale: '提升分辨率与细节',
};

const nodeAliases: Record<TaskProfileId, string> = {
  generate: 'models model create image generate 生成 模型',
  blend: 'blend merge reference 融图 融合',
  angle: 'angle camera spin view 多角度 机位',
  light: 'light lighting relight 定向光 光照',
  remove: 'remove erase clean 去除 擦除',
  extract: 'extract cutout subject 抠图 分离',
  expand: 'resize expand outpaint 扩图 延展',
  upscale: 'upscale enhance resolution 超分 增强',
};

const nestedTools = new Set<TaskProfileId>(['generate', 'expand']);

export function NodeTypePicker({ activeTool = 'generate', position, onClose, onSelect }: NodeTypePickerProps) {
  const [query, setQuery] = useState('');
  const visibleProfiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return nodeOrder
      .map((id) => taskProfiles.find((profile) => profile.id === id))
      .filter((profile): profile is NonNullable<typeof profile> => {
        if (!profile) return false;
        if (!normalizedQuery) return true;
        const haystack = [
          profile.label,
          profile.description,
          nodeDescriptions[profile.id],
          nodeAliases[profile.id],
        ].join(' ').toLowerCase();
        return haystack.includes(normalizedQuery);
      });
  }, [query]);

  return (
    <section
      aria-label="节点类型选择器"
      className="node-type-picker nodrag nowheel"
      role="dialog"
      style={{ left: position.x, top: position.y }}
    >
      <header className="node-type-picker__topbar">
        <label className="node-type-picker__search">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="搜索节点"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            type="search"
            value={query}
          />
        </label>
        <button
          aria-label="关闭节点类型选择器"
          className="icon-button"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="node-type-picker__menu">
        {visibleProfiles.map((profile) => {
          const Icon = toolIcons[profile.id];
          return (
            <button
              aria-label={profile.label}
              aria-pressed={activeTool === profile.id}
              className={activeTool === profile.id ? 'is-active' : ''}
              data-tool={profile.id}
              key={profile.id}
              onClick={() => onSelect(profile.id)}
              title={nodeDescriptions[profile.id]}
              type="button"
            >
              <span className="node-type-picker__icon" style={{ '--tool-accent': profile.accent } as React.CSSProperties}>
                <Icon aria-hidden="true" size={18} />
              </span>
              <span className="node-type-picker__copy">
                <strong>{profile.label}</strong>
              </span>
              {nestedTools.has(profile.id) && <ChevronRight aria-hidden="true" className="node-type-picker__chevron" size={16} />}
            </button>
          );
        })}
        {visibleProfiles.length === 0 && (
          <p className="node-type-picker__empty">没有匹配的节点</p>
        )}
      </div>
    </section>
  );
}
