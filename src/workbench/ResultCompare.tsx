import { Columns3, Info, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Result } from '../domain';
import { getReviewStatusLabel } from './CanvasNodes';
import { useModalFocus } from './useModalFocus';

type ResultCompareProps = {
  results: Result[];
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  onInspect: (resultId: string) => void;
  onRemove: (resultId: string) => void;
};

export function ResultCompare({
  results,
  open,
  onClose,
  onOpen,
  onInspect,
  onRemove,
}: ResultCompareProps) {
  const [zoom, setZoom] = useState(100);
  const dialogRef = useModalFocus<HTMLElement>(onClose, open);
  const viewportRefs = useRef<Array<HTMLDivElement | null>>([]);
  const panGesture = useRef<{
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return undefined;
    const mobile = window.matchMedia('(max-width: 767px)');
    const closeOnMobile = () => {
      if (mobile.matches) onClose();
    };
    closeOnMobile();
    mobile.addEventListener('change', closeOnMobile);
    return () => mobile.removeEventListener('change', closeOnMobile);
  }, [onClose, open]);

  const synchronizeViewport = (sourceIndex: number) => {
    const source = viewportRefs.current[sourceIndex];
    if (!source) return;
    viewportRefs.current.forEach((viewport, index) => {
      if (!viewport || index === sourceIndex) return;
      if (viewport.scrollLeft !== source.scrollLeft) viewport.scrollLeft = source.scrollLeft;
      if (viewport.scrollTop !== source.scrollTop) viewport.scrollTop = source.scrollTop;
    });
  };

  const handlePointerDown = (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRefs.current[index];
    if (!viewport) return;
    panGesture.current = {
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  };

  const handlePointerMove = (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGesture.current;
    const viewport = viewportRefs.current[index];
    if (!gesture || !viewport || gesture.index !== index || gesture.pointerId !== event.pointerId) return;
    viewport.scrollLeft = gesture.scrollLeft - (event.clientX - gesture.startX);
    viewport.scrollTop = gesture.scrollTop - (event.clientY - gesture.startY);
    synchronizeViewport(index);
  };

  const handlePointerEnd = (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGesture.current;
    const viewport = viewportRefs.current[index];
    if (!gesture || !viewport || gesture.index !== index || gesture.pointerId !== event.pointerId) return;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    viewport.classList.remove('is-panning');
    panGesture.current = null;
  };

  if (results.length === 0) return null;

  return (
    <>
      <section aria-label="结果对比栏" className="result-compare-tray">
        <div className="result-compare-tray__summary">
          <Columns3 aria-hidden="true" size={16} />
          <strong>结果对比</strong>
          <span>已选 {results.length} / 4</span>
        </div>
        <div className="result-compare-tray__items">
          {results.map((result) => (
            <div key={result.id}>
              <img alt="" src={result.imageUrl} />
              <span>{result.title}</span>
              <button
                aria-label={`从对比移除${result.title}`}
                onClick={() => onRemove(result.id)}
                title="移出对比"
                type="button"
              >
                <X aria-hidden="true" size={13} />
              </button>
            </div>
          ))}
        </div>
        <button className="result-compare-tray__open" disabled={results.length < 2} onClick={onOpen} type="button">
          开始对比
        </button>
      </section>

      {open && (
        <div className="result-dialog-backdrop result-compare-backdrop">
          <section
            aria-label="结果对比"
            aria-modal="true"
            className="result-compare-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header>
              <div>
                <span>统一视图</span>
                <strong>结果对比</strong>
              </div>
              <label>
                <span>缩放</span>
                <input
                  aria-label="对比缩放"
                  max={200}
                  min={25}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  step={25}
                  type="range"
                  value={zoom}
                />
                <output>{zoom}%</output>
              </label>
              <button aria-label="关闭结果对比" data-dialog-initial-focus onClick={onClose} title="关闭" type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <div className="result-compare-grid" data-count={results.length}>
              {results.map((result, index) => (
                <article key={result.id}>
                  <div
                    className="result-compare-grid__viewport"
                    onPointerCancel={(event) => handlePointerEnd(index, event)}
                    onPointerDown={(event) => handlePointerDown(index, event)}
                    onPointerMove={(event) => handlePointerMove(index, event)}
                    onPointerUp={(event) => handlePointerEnd(index, event)}
                    onScroll={() => synchronizeViewport(index)}
                    ref={(element) => { viewportRefs.current[index] = element; }}
                  >
                    <img
                      alt={result.title}
                      src={result.imageUrl}
                      style={{ width: `${zoom}%` }}
                    />
                  </div>
                  <footer>
                    <div>
                      <strong>{result.title}</strong>
                      <span>{getReviewStatusLabel(result.reviewStatus)}</span>
                    </div>
                    <div className="result-compare-grid__states">
                      {result.isAdopted && <span>已采用</span>}
                      {result.isPrimary && <span>主结果</span>}
                    </div>
                    <button
                      aria-label={`查看${result.title}详情`}
                      onClick={() => onInspect(result.id)}
                      title="查看详情"
                      type="button"
                    >
                      <Info aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={`从对比移除${result.title}`}
                      onClick={() => onRemove(result.id)}
                      title="移出对比"
                      type="button"
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
