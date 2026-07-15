import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { getProfile } from '../domain';
import type { DraftTaskNodeData } from './graph';
import { toolIcons } from './ToolPalette';

export function DraftTaskNode({ data }: NodeProps<Node<DraftTaskNodeData, 'draft-task'>>) {
  const profile = getProfile(data.tool);
  const Icon = toolIcons[data.tool];

  return (
    <article className="draft-task-node" data-tool={data.tool}>
      <Handle type="target" position={Position.Left} />
      <header>
        <span className="draft-task-node__icon" style={{ '--tool-accent': profile.accent } as React.CSSProperties}>
          <Icon aria-hidden="true" size={21} />
        </span>
        <button
          aria-label="取消新增节点"
          className="icon-button nodrag"
          onClick={(event) => {
            event.stopPropagation();
            data.onCancel?.();
          }}
          title="取消新增节点"
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>
      <div className="draft-task-node__body">
        <strong>{profile.label}</strong>
        <span>待配置</span>
        <small>设置参数后创建任务</small>
      </div>
    </article>
  );
}
