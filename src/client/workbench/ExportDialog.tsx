import { FileArchive, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ExportFormat, ExportSize, ExportSpec, Result } from '../../shared/domain';
import { useModalFocus } from './useModalFocus';

type ExportDialogProps = {
  result: Result;
  buildFilename: (spec: ExportSpec) => string;
  onClose: () => void;
  onSubmit: (spec: ExportSpec) => Promise<void> | void;
};

export function ExportDialog({ result, buildFilename, onClose, onSubmit }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [size, setSize] = useState<ExportSize>('original');
  const [includeManifestCsv, setIncludeManifestCsv] = useState(true);
  const [includeManifestJson, setIncludeManifestJson] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const dialogRef = useModalFocus<HTMLElement>(onClose);
  const spec = useMemo<ExportSpec>(() => ({
    format,
    size,
    includeManifestCsv,
    includeManifestJson,
  }), [format, includeManifestCsv, includeManifestJson, size]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await onSubmit(spec);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导出失败，请重试');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="result-dialog-backdrop">
      <section
        aria-label="生产导出"
        aria-modal="true"
        className="export-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <FileArchive aria-hidden="true" size={18} />
            <span>生产交付</span>
            <strong>{result.title}</strong>
          </div>
          <button aria-label="关闭生产导出" onClick={onClose} title="关闭" type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="export-dialog__body">
          <label>
            <span>文件格式</span>
            <select aria-label="文件格式" data-dialog-initial-focus onChange={(event) => setFormat(event.target.value as ExportFormat)} value={format}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <label>
            <span>输出尺寸</span>
            <select aria-label="输出尺寸" onChange={(event) => setSize(event.target.value as ExportSize)} value={size}>
              <option value="original">原始尺寸（不放大）</option>
              <option value="1080">1080 px（不放大）</option>
              <option value="2048">2048 px（不放大）</option>
            </select>
          </label>
          <fieldset>
            <legend>附带清单</legend>
            <label>
              <input checked={includeManifestCsv} onChange={(event) => setIncludeManifestCsv(event.target.checked)} type="checkbox" />
              manifest.csv
            </label>
            <label>
              <input checked={includeManifestJson} onChange={(event) => setIncludeManifestJson(event.target.checked)} type="checkbox" />
              manifest.json
            </label>
          </fieldset>
          <div className="export-dialog__filename">
            <span>文件名预览</span>
            <code>{buildFilename(spec)}</code>
          </div>
          <p>{format === 'jpeg' ? 'JPEG 不保留透明通道，透明区域将使用白色背景。' : '保持当前色彩与审核版本，不执行额外放大。'}</p>
          {errorMessage && <p className="export-dialog__error" role="alert">{errorMessage}</p>}
        </div>
        <footer>
          <span>导出完成后保留 24 小时</span>
          <button disabled={isSubmitting} onClick={onClose} type="button">取消</button>
          <button className="is-primary" disabled={isSubmitting} onClick={handleSubmit} type="button">
            {isSubmitting ? '正在生成交付文件' : '生成生产导出'}
          </button>
        </footer>
      </section>
    </div>
  );
}
