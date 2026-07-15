import { useState } from 'react';
import {
  approveResult,
  completeJob,
  createDerivedScene,
  createJob,
  initialStudioState,
  submitForReview,
  type StudioState,
} from './domain';
import { GlobalNav, SecondaryView, type NavKey } from './SecondaryViews';
import { Workbench } from './workbench/Workbench';

function App() {
  const [state, setState] = useState<StudioState>(() => seedDemoState());
  const [activeNav, setActiveNav] = useState<NavKey>('studio');

  return (
    <div className={`app-frame ${activeNav === 'studio' ? 'is-workbench' : ''}`}>
      <GlobalNav activeNav={activeNav} onNavigate={setActiveNav} state={state} />
      <div className={`workspace ${activeNav === 'studio' ? 'is-workbench' : ''}`}>
        <div className="workspace-panel workspace-panel--workbench" hidden={activeNav !== 'studio'}>
          <Workbench state={state} setState={setState} />
        </div>
        <div className="workspace-panel workspace-panel--secondary" hidden={activeNav === 'studio'}>
          <SecondaryView activeNav={activeNav} setState={setState} state={state} />
        </div>
      </div>
    </div>
  );
}

function seedDemoState(): StudioState {
  const base = initialStudioState();
  const withGenerate = createJob(base, { sceneId: 'scene-source', profileId: 'generate', outputCount: 4 });
  const settled = completeJob(withGenerate, withGenerate.jobs[0].id, {
    successfulOutputs: 3,
    actualCredits: 45,
  });
  const derived = createDerivedScene(settled, {
    parentSceneId: 'scene-source',
    sourceResultId: settled.results[0].id,
    operation: '融图',
  });
  const withPendingReviews = submitForReview(
    submitForReview(derived, settled.results[0].id),
    settled.results[1].id,
  );
  return approveResult(withPendingReviews, settled.results[1].id, '青井审核员');
}

export default App;
