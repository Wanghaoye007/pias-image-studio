import { ChevronRight, X } from 'lucide-react';
import { taskProfiles, type TaskProfileId } from '../../shared/domain';
import { toolIcons } from './ToolPalette';

type NodeTypePickerProps = {
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (tool: TaskProfileId) => void;
};

const nodeGroups: Array<{
  label: string;
  tools: TaskProfileId[];
}> = [
  { label: '创作与重构', tools: ['generate', 'blend', 'angle', 'light'] },
  { label: '编辑与增强', tools: ['remove', 'extract', 'expand', 'upscale'] },
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

export function NodeTypePicker({ position, onClose, onSelect }: NodeTypePickerProps) {
  return (
    <section
      aria-label="节点类型选择器"
      className="node-type-picker nodrag nowheel"
      role="dialog"
      style={{ left: position.x, top: position.y }}
    >
      <header>
        <div>
          <strong>添加处理节点</strong>
          <small>从当前画面继续创作</small>
        </div>
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
      <div className="node-type-picker__grid">
        {nodeGroups.map((group) => (
          <section className="node-type-picker__group" key={group.label}>
            <small>{group.label}</small>
            <div>
              {group.tools.map((tool) => {
                const profile = taskProfiles.find((item) => item.id === tool);
                if (!profile) return null;
                const Icon = toolIcons[profile.id];
                return (
                  <button
                    aria-label={profile.label}
                    data-tool={profile.id}
                    key={profile.id}
                    onClick={() => onSelect(profile.id)}
                    type="button"
                  >
                    <span className="node-type-picker__icon" style={{ '--tool-accent': profile.accent } as React.CSSProperties}>
                      <Icon aria-hidden="true" size={17} />
                    </span>
                    <span className="node-type-picker__copy">
                      <strong>{profile.label}</strong>
                      <small>{nodeDescriptions[profile.id]}</small>
                    </span>
                    <ChevronRight aria-hidden="true" className="node-type-picker__chevron" size={15} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
