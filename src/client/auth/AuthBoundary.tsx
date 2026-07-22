import { ArrowLeft, Box, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  completeMfa,
  getPreferredProjectId,
  loadAuthSession,
  login,
  logout,
  setActiveProjectId,
  type ActiveAuthSession,
} from './authClient';

export type AuthBoundaryValue = {
  activeProjectId: string;
  activateProject: (projectId: string) => void;
  session: ActiveAuthSession;
  logout: () => Promise<void>;
};

type AuthBoundaryProps = {
  children: (value: AuthBoundaryValue) => ReactNode;
};

type BoundaryState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'anonymous' }
  | { status: 'mfa_required' }
  | {
      status: 'authenticated';
      user: Extract<ActiveAuthSession, { status: 'authenticated' }>['user'];
      activeProjectId: string;
      expiresAt?: string;
    }
  | { status: 'error'; message: string };

export function AuthBoundary({ children }: AuthBoundaryProps) {
  const [state, setState] = useState<BoundaryState>({ status: 'loading' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let active = true;
    void loadAuthSession().then((session) => {
      if (!active) return;
      if (session.status === 'authenticated') {
        const projectId = getPreferredProjectId(session.user.projectIds);
        if (!projectId) {
          setState({ status: 'error', message: '账户尚未分配可访问项目' });
          return;
        }
        setActiveProjectId(projectId);
      } else {
        setActiveProjectId('');
      }
      setState(session.status === 'authenticated'
        ? {
            status: 'authenticated',
            user: session.user,
            activeProjectId: getPreferredProjectId(session.user.projectIds),
            expiresAt: session.expiresAt,
          }
        : { status: session.status });
    }).catch((error: unknown) => {
      if (!active) return;
      setState({ status: 'error', message: errorMessage(error) });
    });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      const result = await login(email, password);
      setPassword('');
      if (result.status === 'mfa_required') {
        setState({ status: 'mfa_required' });
      } else {
        const projectId = getPreferredProjectId(result.user.projectIds);
        if (!projectId) throw new Error('账户尚未分配可访问项目');
        setActiveProjectId(projectId);
        setState({
          status: 'authenticated',
          user: result.user,
          activeProjectId: projectId,
          expiresAt: result.expiresAt,
        });
      }
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfa = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      const result = await completeMfa(code);
      if (result.status !== 'authenticated') throw new Error('身份验证未完成');
      const projectId = getPreferredProjectId(result.user.projectIds);
      if (!projectId) throw new Error('账户尚未分配可访问项目');
      setActiveProjectId(projectId);
      setCode('');
      setState({
        status: 'authenticated',
        user: result.user,
        activeProjectId: projectId,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setActiveProjectId('');
    setEmail('');
    setPassword('');
    setCode('');
    setFormError('');
    setState({ status: 'anonymous' });
  };

  const handleActivateProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setState((current) => current.status === 'authenticated'
      ? { ...current, activeProjectId: projectId }
      : current);
  };

  if (state.status === 'loading') {
    return <AuthStateScreen title="正在验证身份" message="正在恢复安全会话" loading />;
  }
  if (state.status === 'error') {
    return <AuthStateScreen title="身份服务不可用" message={state.message} />;
  }
  if (state.status === 'disabled') {
    return children({
      activeProjectId: '',
      activateProject: () => undefined,
      session: { status: 'disabled' },
      logout: async () => undefined,
    });
  }
  if (state.status === 'authenticated') {
    return children({
      activeProjectId: state.activeProjectId,
      activateProject: handleActivateProject,
      session: { status: 'authenticated', user: state.user, expiresAt: state.expiresAt },
      logout: handleLogout,
    });
  }

  const mfa = state.status === 'mfa_required';
  return (
    <main className="auth-screen">
      <section aria-labelledby="auth-title" className="auth-panel">
        <div className="auth-brand">
          <span className="auth-brand__mark"><Box aria-hidden="true" size={21} /></span>
          <div><strong>PIAS 图片</strong><small>企业内容生产工作台</small></div>
        </div>
        <div className="auth-heading">
          <span className="auth-heading__icon">
            {mfa ? <ShieldCheck aria-hidden="true" size={22} /> : <KeyRound aria-hidden="true" size={22} />}
          </span>
          <div>
            <h1 id="auth-title">{mfa ? '验证身份' : '登录 PIAS'}</h1>
            <p>{mfa ? '输入验证器中当前显示的六位验证码' : '使用企业账户继续进入图片工作台'}</p>
          </div>
        </div>

        {mfa ? (
          <form className="auth-form" onSubmit={handleMfa}>
            <label>
              <span>六位验证码</span>
              <input
                autoComplete="one-time-code"
                autoFocus
                inputMode="numeric"
                maxLength={6}
                name="code"
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                pattern="[0-9]{6}"
                required
                type="text"
                value={code}
              />
            </label>
            {formError && <p className="auth-error" role="alert">{formError}</p>}
            <button className="auth-submit" disabled={submitting || code.length !== 6} type="submit">
              {submitting && <LoaderCircle aria-hidden="true" className="auth-spinner" size={17} />}
              进入工作台
            </button>
            <button
              className="auth-back"
              disabled={submitting}
              onClick={() => {
                setCode('');
                setFormError('');
                setState({ status: 'anonymous' });
              }}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={16} /> 返回登录
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              <span>邮箱</span>
              <input
                autoComplete="username"
                autoFocus
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              <span>密码</span>
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            {formError && <p className="auth-error" role="alert">{formError}</p>}
            <button className="auth-submit" disabled={submitting} type="submit">
              {submitting && <LoaderCircle aria-hidden="true" className="auth-spinner" size={17} />}
              继续
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function AuthStateScreen({
  title,
  message,
  loading = false,
}: {
  title: string;
  message: string;
  loading?: boolean;
}) {
  return (
    <main aria-live="polite" className="auth-screen auth-screen--state">
      {loading && <LoaderCircle aria-hidden="true" className="auth-spinner" size={24} />}
      <h1>{title}</h1>
      <p>{message}</p>
    </main>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '身份验证失败，请稍后重试';
}
