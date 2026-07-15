import { ChevronDown, ChevronUp, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { getProfile, type GenerationJob } from '../domain';
import { getJobStatusLabel } from './CanvasNodes';

type TaskTrayProps = {
  jobs: GenerationJob[];
  onCancel: (jobId: string) => void;
  onRetry: (job: GenerationJob) => void;
};

export function TaskTray({ jobs, onCancel, onRetry }: TaskTrayProps) {
  const [open, setOpen] = useState(false);
  const activeCount = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;

  return (
    <section className={`task-tray ${open ? 'is-open' : ''}`} aria-label="任务抽屉">
      <button
        aria-expanded={open}
        aria-label={`任务队列，${activeCount} 个进行中任务，${open ? '收起' : '展开'}`}
        className="task-tray__toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>任务队列</span>
        <strong>{activeCount}</strong>
        {open ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>

      {open && (
        <div className="task-tray__content">
          {jobs.length === 0 && <p>暂无任务</p>}
          {jobs.map((job) => {
            const canCancel = job.status === 'queued' || job.status === 'running';
            return (
              <article className={`task-row is-${job.status}`} key={job.id}>
                <div>
                  <strong>{getProfile(job.profileId).label}</strong>
                  <span>{getJobStatusLabel(job.status)}</span>
                  <small>{job.progress}%</small>
                </div>
                <progress aria-label={`${getProfile(job.profileId).label}任务进度`} max={100} value={job.progress} />
                {job.errorMessage && <p role="alert">{job.errorMessage}</p>}
                {canCancel && (
                  <button aria-label="取消任务" onClick={() => onCancel(job.id)} title="取消任务" type="button">
                    <XCircle size={16} />
                  </button>
                )}
                {job.status === 'failed' && (
                  <button aria-label="重试任务" onClick={() => onRetry(job)} title="重试任务" type="button">
                    <RotateCcw size={16} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
