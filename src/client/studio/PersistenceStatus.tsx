import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import type { StudioSaveStatus } from './usePersistentStudioState';

export function PersistenceStatus({
  status,
  onRetry,
  onReload,
}: {
  status: StudioSaveStatus;
  onRetry: () => void;
  onReload: () => void;
}) {
  if (status === 'saving' || status === 'idle') {
    return (
      <span aria-label="保存状态" className="persistence-status is-saving" role="status">
        <LoaderCircle aria-hidden="true" className="is-spinning" size={15} />
        正在保存
      </span>
    );
  }
  if (status === 'error') {
    return (
      <button aria-label="重试保存" className="persistence-status is-error" onClick={onRetry} type="button">
        <RefreshCw aria-hidden="true" size={15} />
        保存失败
      </button>
    );
  }
  if (status === 'conflict') {
    return (
      <button aria-label="重新加载" className="persistence-status is-conflict" onClick={onReload} type="button">
        <AlertTriangle aria-hidden="true" size={15} />
        存在更新冲突
      </button>
    );
  }
  return (
    <span aria-label="保存状态" className="persistence-status is-saved" role="status">
      <CheckCircle2 aria-hidden="true" size={15} />
      已自动保存
    </span>
  );
}
