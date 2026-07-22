import { lazy, Suspense, useEffect, useState } from 'react';
import { GlobalNav, type NavKey } from './GlobalNav';
import { AuthBoundary, type AuthBoundaryValue } from './auth/AuthBoundary';
import { listProjects } from './organization/organizationClient';
import { InvitationAcceptance, readInvitationToken } from './organization/InvitationAcceptance';
import type { OrganizationProject } from './organization/organizationService';
import { createBlankProjectStudioState } from './studio/demoState';
import { usePersistentStudioState } from './studio/usePersistentStudioState';

const SecondaryView = lazy(() => import('./SecondaryViews'));
const Workbench = lazy(() => import('./workbench/Workbench'));

function App() {
  const [invitationToken, setInvitationToken] = useState(() => readInvitationToken(window.location.hash));
  if (invitationToken) {
    return (
      <InvitationAcceptance
        onComplete={() => {
          window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
          setInvitationToken('');
        }}
        token={invitationToken}
      />
    );
  }
  return (
    <AuthBoundary>
      {(auth) => <StudioApplication auth={auth} />}
    </AuthBoundary>
  );
}

function StudioApplication({ auth }: { auth: AuthBoundaryValue }) {
  const [activeProject, setActiveProject] = useState<OrganizationProject | null | undefined>(
    auth.session.status === 'authenticated' ? undefined : null,
  );

  useEffect(() => {
    if (auth.session.status !== 'authenticated') {
      setActiveProject(null);
      return;
    }
    if (activeProject?.id === auth.activeProjectId) return;
    let current = true;
    setActiveProject(undefined);
    void listProjects().then((projects) => {
      if (current) {
        setActiveProject(projects.find((project) => project.id === auth.activeProjectId) ?? null);
      }
    }).catch(() => {
      if (current) setActiveProject(null);
    });
    return () => { current = false; };
  }, [activeProject?.id, auth.activeProjectId, auth.session.status]);

  if (activeProject === undefined) {
    return (
      <main aria-live="polite" className="app-state-screen">
        <div className="app-state-screen__indicator" />
        <h1>正在读取项目</h1>
        <p>正在确认当前项目范围与基础配置</p>
      </main>
    );
  }

  return (
    <StudioWorkspace
      activeProject={activeProject}
      auth={auth}
      onOpenProject={(project) => {
        setActiveProject(project);
        auth.activateProject(project.id);
      }}
    />
  );
}

function StudioWorkspace({
  activeProject,
  auth,
  onOpenProject,
}: {
  activeProject: OrganizationProject | null;
  auth: AuthBoundaryValue;
  onOpenProject: (project: OrganizationProject) => void;
}) {
  const projectScope = auth.activeProjectId;
  const {
    state,
    setState,
    loadStatus,
    saveStatus,
    errorMessage,
    retryLoad,
    retrySave,
  } = usePersistentStudioState(
    projectScope,
    auth.session.status === 'authenticated'
      ? createBlankProjectStudioState(activeProject ?? { name: '新建图片项目' })
      : undefined,
  );
  const [activeNav, setActiveNav] = useState<NavKey>('studio');
  const [secondaryRequested, setSecondaryRequested] = useState(false);

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
      <GlobalNav
        activeNav={activeNav}
        authSession={auth.session}
        onLogout={auth.logout}
        onNavigate={(nextNav) => {
          if (nextNav !== 'studio') setSecondaryRequested(true);
          setActiveNav(nextNav);
        }}
        state={state}
      />
      <div className={`workspace ${activeNav === 'studio' ? 'is-workbench' : ''}`}>
        <div className="workspace-panel workspace-panel--workbench" hidden={activeNav !== 'studio'}>
          <Suspense fallback={<WorkbenchFallback />}>
            <Workbench
              actorId={auth.session.status === 'authenticated' ? auth.session.user.id : 'Mika Tanaka'}
              onReloadState={retryLoad}
              onRetrySave={retrySave}
              saveStatus={saveStatus}
              state={state}
              setState={setState}
            />
          </Suspense>
        </div>
        <div className="workspace-panel workspace-panel--secondary" hidden={activeNav === 'studio'}>
          {secondaryRequested && (
            <Suspense fallback={<SecondaryViewFallback />}>
              <SecondaryView
                activeNav={activeNav}
                activeProject={activeProject}
                activeProjectId={projectScope}
                authSession={auth.session}
                onOpenProject={(project) => {
                  onOpenProject(project);
                  setActiveNav('studio');
                }}
                onReloadState={retryLoad}
                onRetrySave={retrySave}
                saveStatus={saveStatus}
                setState={setState}
                state={state}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkbenchFallback() {
  return (
    <main aria-live="polite" className="app-state-screen">
      <div className="app-state-screen__indicator" />
      <h1>正在打开工作台</h1>
      <p>正在准备节点画布</p>
    </main>
  );
}

function SecondaryViewFallback() {
  return (
    <main aria-live="polite" className="app-state-screen">
      <div className="app-state-screen__indicator" />
      <h1>正在打开页面</h1>
      <p>正在读取项目数据</p>
    </main>
  );
}

export default App;
