import { Box, Check, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { acceptInvitation, previewInvitation } from './organizationClient';
import type { OrganizationInvitationPreview } from '../../shared/organization/types';

export function InvitationAcceptance({
  token,
  onComplete,
}: {
  token: string;
  onComplete: () => void;
}) {
  const [invitation, setInvitation] = useState<OrganizationInvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mfaSecret] = useState(generateMfaSecret);
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    void previewInvitation(token).then((value) => {
      if (!active) return;
      setInvitation(value);
      setDisplayName(value.displayName ?? '');
      setLoading(false);
    }).catch((nextError: unknown) => {
      if (!active) return;
      setError(errorMessage(nextError, '邀请链接无效或已失效'));
      setLoading(false);
    });
    return () => { active = false; };
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await acceptInvitation({
        token,
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(invitation?.role === 'admin' ? { mfaSecret, mfaCode } : {}),
      });
      setPassword('');
      setConfirmation('');
      setMfaCode('');
      setCompleted(true);
    } catch (nextError) {
      setError(errorMessage(nextError, '接受邀请失败'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main aria-live="polite" className="auth-screen auth-screen--state">
        <LoaderCircle aria-hidden="true" className="auth-spinner" size={24} />
        <h1>正在读取邀请</h1>
        <p>正在验证邀请状态与项目范围</p>
      </main>
    );
  }

  if (!invitation) {
    return (
      <main className="auth-screen auth-screen--state">
        <KeyRound aria-hidden="true" size={24} />
        <h1>邀请无法使用</h1>
        <p role="alert">{error}</p>
      </main>
    );
  }

  if (completed) {
    return (
      <main className="auth-screen auth-screen--state invitation-complete">
        <Check aria-hidden="true" size={26} />
        <h1>账户已创建</h1>
        <p>企业成员身份与项目权限已经生效</p>
        <button className="auth-submit" onClick={onComplete} type="button">前往登录</button>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <section aria-labelledby="invitation-title" className="auth-panel invitation-panel">
        <div className="auth-brand">
          <span className="auth-brand__mark"><Box aria-hidden="true" size={21} /></span>
          <div><strong>PIAS 图片</strong><small>企业内容生产工作台</small></div>
        </div>
        <div className="auth-heading">
          <span className="auth-heading__icon"><ShieldCheck aria-hidden="true" size={22} /></span>
          <div>
            <h1 id="invitation-title">接受企业邀请</h1>
            <p>创建账户后即可进入已分配的项目</p>
          </div>
        </div>
        <dl className="invitation-summary">
          <div><dt>企业邮箱</dt><dd>{invitation.email}</dd></div>
          <div><dt>成员角色</dt><dd>{roleLabel(invitation.role)}</dd></div>
          <div><dt>项目数量</dt><dd>{invitation.projectIds.length} 个</dd></div>
          <div><dt>有效期至</dt><dd>{formatDate(invitation.expiresAt)}</dd></div>
        </dl>
        <form className="auth-form" onSubmit={(event) => { void submit(event); }}>
          <label>
            <span>显示名称</span>
            <input autoComplete="name" maxLength={80} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
          <label>
            <span>设置密码</span>
            <input aria-label="设置密码" autoComplete="new-password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <label>
            <span>确认密码</span>
            <input aria-label="确认密码" autoComplete="new-password" minLength={12} onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} />
          </label>
          {invitation.role === 'admin' && (
            <div className="invitation-mfa">
              <strong>配置管理员多因素认证</strong>
              <p>在验证器中手动添加以下密钥，再输入当前六位验证码。</p>
              <code>{mfaSecret}</code>
              <label>
                <span>六位验证码</span>
                <input aria-label="六位验证码" autoComplete="one-time-code" inputMode="numeric" maxLength={6} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" required value={mfaCode} />
              </label>
            </div>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button
            className="auth-submit"
            disabled={submitting || password.length < 12 || password !== confirmation || (invitation.role === 'admin' && mfaCode.length !== 6)}
            type="submit"
          >
            {submitting && <LoaderCircle aria-hidden="true" className="auth-spinner" size={17} />}
            接受并创建账户
          </button>
        </form>
      </section>
    </main>
  );
}

export function readInvitationToken(hash: string): string {
  const match = /^#\/accept-invitation\?(.*)$/.exec(hash);
  if (!match) return '';
  const token = new URLSearchParams(match[1]).get('token') ?? '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}

function generateMfaSecret(): string {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let index = 0; index < bits.length; index += 5) {
    result += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  }
  return result;
}

function roleLabel(role: OrganizationInvitationPreview['role']): string {
  return ({ admin: '管理员', creator: '创作者', reviewer: '审核员', viewer: '只读成员' })[role];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
