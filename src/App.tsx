import { useState } from 'react';
import { GlobalNav, SecondaryView, type NavKey } from './SecondaryViews';
import { usePersistentStudioState } from './studio/usePersistentStudioState';
import { Workbench } from './workbench/Workbench';

function App() {
  const {
    state,
    setState,
    loadStatus,
    saveStatus,
    errorMessage,
    retryLoad,
    retrySave,
  } = usePersistentStudioState();
  const [activeNav, setActiveNav] = useState<NavKey>('studio');

  if (loadStatus === 'error') {
    return (
      <main className="app-state-screen">
        <h1>工作台恢复失败</h1>
        <p>{errorMessage}</p>
        <button onClick={retryLoad} type="button">重试加载</button>
      </main>
    );
  }

  if (loadStatus === 'loading' || !state) {
    return (
      <main aria-live="polite" className="app-state-screen">
        <div className="app-state-screen__indicator" />
        <h1>正在恢复工作台</h1>
        <p>正在读取已确认的项目、画布和任务状态</p>
      </main>
    );
  }

  return (
    <div className={`app-frame ${activeNav === 'studio' ? 'is-workbench' : ''}`}>
      <GlobalNav activeNav={activeNav} onNavigate={setActiveNav} state={state} />
      <div className={`workspace ${activeNav === 'studio' ? 'is-workbench' : ''}`}>
        <div className="workspace-panel workspace-panel--workbench" hidden={activeNav !== 'studio'}>
          <Workbench
            onReloadState={retryLoad}
            onRetrySave={retrySave}
            saveStatus={saveStatus}
            state={state}
            setState={setState}
          />
        </div>
        <div className="workspace-panel workspace-panel--secondary" hidden={activeNav === 'studio'}>
          <SecondaryView
            activeNav={activeNav}
            onReloadState={retryLoad}
            onRetrySave={retrySave}
            saveStatus={saveStatus}
            setState={setState}
            state={state}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
