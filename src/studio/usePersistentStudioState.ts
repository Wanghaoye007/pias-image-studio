import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { StudioState } from '../domain';
import {
  loadStudioState,
  saveStudioState,
  type StudioStateClientError,
} from './studioStateClient';
import { createDemoStudioState } from './demoState';

export type StudioSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
export type StudioLoadStatus = 'loading' | 'ready' | 'error';

export type PersistentStudioState = {
  state: StudioState | null;
  setState: Dispatch<SetStateAction<StudioState>>;
  loadStatus: StudioLoadStatus;
  saveStatus: StudioSaveStatus;
  errorMessage: string;
  retryLoad(): void;
  retrySave(): void;
};

const autosaveDelayMs = 400;

export function usePersistentStudioState(): PersistentStudioState {
  const [state, setStateValue] = useState<StudioState | null>(null);
  const [loadStatus, setLoadStatus] = useState<StudioLoadStatus>('loading');
  const [saveStatus, setSaveStatus] = useState<StudioSaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const stateRef = useRef<StudioState | null>(null);
  const revisionRef = useRef(0);
  const confirmedJsonRef = useRef('');
  const queuedStateRef = useRef<StudioState | null>(null);
  const inFlightRef = useRef(false);
  const blockedRef = useRef(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSaveRef = useRef<() => void>(() => undefined);

  useEffect(() => () => {
    mountedRef.current = false;
    sessionRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    let active = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    inFlightRef.current = false;
    blockedRef.current = false;
    queuedStateRef.current = null;
    confirmedJsonRef.current = '';
    revisionRef.current = 0;
    stateRef.current = null;
    setStateValue(null);
    setLoadStatus('loading');
    setSaveStatus('idle');
    setErrorMessage('');

    void loadStudioState().then((snapshot) => {
      if (!active || !mountedRef.current || sessionRef.current !== session) return;
      const restoredState = snapshot?.state ?? createDemoStudioState();
      revisionRef.current = snapshot?.revision ?? 0;
      confirmedJsonRef.current = snapshot ? JSON.stringify(restoredState) : '';
      stateRef.current = restoredState;
      setStateValue(restoredState);
      setLoadStatus('ready');
      setSaveStatus(snapshot ? 'saved' : 'idle');
    }).catch((error: unknown) => {
      if (!active || !mountedRef.current || sessionRef.current !== session) return;
      setLoadStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '无法恢复工作台状态');
    });

    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const flushSave = useCallback(() => {
    if (blockedRef.current || inFlightRef.current || !mountedRef.current) return;
    const pending = queuedStateRef.current ?? stateRef.current;
    if (!pending) return;
    const pendingJson = JSON.stringify(pending);
    if (pendingJson === confirmedJsonRef.current) {
      queuedStateRef.current = null;
      setSaveStatus('saved');
      return;
    }

    queuedStateRef.current = null;
    inFlightRef.current = true;
    setSaveStatus('saving');
    setErrorMessage('');
    const expectedRevision = revisionRef.current;
    const session = sessionRef.current;

    void saveStudioState(expectedRevision, pending).then((meta) => {
      if (!mountedRef.current || sessionRef.current !== session) return;
      revisionRef.current = meta.revision;
      confirmedJsonRef.current = pendingJson;
      inFlightRef.current = false;
      const latest = stateRef.current;
      if (latest && JSON.stringify(latest) !== confirmedJsonRef.current) {
        queuedStateRef.current = latest;
        queueMicrotask(() => flushSaveRef.current());
        return;
      }
      setSaveStatus('saved');
    }).catch((error: unknown) => {
      if (!mountedRef.current || sessionRef.current !== session) return;
      inFlightRef.current = false;
      queuedStateRef.current = stateRef.current;
      const clientError = error as Partial<StudioStateClientError>;
      if (clientError.code === 'STUDIO_STATE_CONFLICT' || clientError.status === 409) {
        blockedRef.current = true;
        setSaveStatus('conflict');
        setErrorMessage('工作台状态已在其他页面更新');
        return;
      }
      setSaveStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '保存工作台状态失败');
    });
  }, []);
  flushSaveRef.current = flushSave;

  useEffect(() => {
    stateRef.current = state;
    if (loadStatus !== 'ready' || !state || blockedRef.current) return;
    const serialized = JSON.stringify(state);
    if (serialized === confirmedJsonRef.current) return;

    queuedStateRef.current = state;
    setSaveStatus('saving');
    if (inFlightRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushSaveRef.current();
    }, autosaveDelayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [loadStatus, state]);

  const setState: Dispatch<SetStateAction<StudioState>> = useCallback((update) => {
    setStateValue((current) => {
      if (!current) return current;
      const next = typeof update === 'function' ? update(current) : update;
      stateRef.current = next;
      return next;
    });
  }, []);

  const retryLoad = useCallback(() => {
    setLoadAttempt((current) => current + 1);
  }, []);

  const retrySave = useCallback(() => {
    if (blockedRef.current || !stateRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    queuedStateRef.current = stateRef.current;
    flushSaveRef.current();
  }, []);

  return {
    state,
    setState,
    loadStatus,
    saveStatus,
    errorMessage,
    retryLoad,
    retrySave,
  };
}
