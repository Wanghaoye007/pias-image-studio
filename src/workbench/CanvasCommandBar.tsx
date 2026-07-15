import { Copy, Focus, Pencil, Plus, Trash2 } from 'lucide-react';

type CanvasCommandBarProps = {
  hasSelectedScene: boolean;
  onCreate: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onFit: () => void;
  onRename: () => void;
};

export function CanvasCommandBar({
  hasSelectedScene,
  onCreate,
  onDelete,
  onDuplicate,
  onFit,
  onRename,
}: CanvasCommandBarProps) {
  return (
    <div aria-label="节点命令" className="canvas-command-bar" role="toolbar">
      <button aria-label="新建空白场景" onClick={onCreate} title="新建空白场景" type="button">
        <Plus size={17} />
      </button>
      <button
        aria-label="复制选中节点"
        disabled={!hasSelectedScene}
        onClick={onDuplicate}
        title="复制选中节点"
        type="button"
      >
        <Copy size={16} />
      </button>
      <button
        aria-label="重命名选中节点"
        disabled={!hasSelectedScene}
        onClick={onRename}
        title="重命名选中节点"
        type="button"
      >
        <Pencil size={16} />
      </button>
      <button
        aria-label="删除选中节点"
        disabled={!hasSelectedScene}
        onClick={onDelete}
        title="删除选中节点"
        type="button"
      >
        <Trash2 size={16} />
      </button>
      <span aria-hidden="true" />
      <button aria-label="适配全部节点" onClick={onFit} title="适配全部节点" type="button">
        <Focus size={16} />
      </button>
    </div>
  );
}
