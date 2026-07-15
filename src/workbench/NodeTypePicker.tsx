import { X } from 'lucide-react';
import { taskProfiles, type TaskProfileId } from '../domain';
import { toolIcons } from './ToolPalette';

type NodeTypePickerProps = {
  position: { x: number; y: number };
  onClose: () => void;
  onSelect: (tool: TaskProfileId) => void;
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
        <strong>添加处理节点</strong>
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
        {taskProfiles.map((profile) => {
          const Icon = toolIcons[profile.id];
          return (
            <button
              aria-label={profile.label}
              key={profile.id}
              onClick={() => onSelect(profile.id)}
              type="button"
            >
              <span className="node-type-picker__icon" style={{ '--tool-accent': profile.accent } as React.CSSProperties}>
                <Icon aria-hidden="true" size={18} />
              </span>
              <strong>{profile.label}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}
