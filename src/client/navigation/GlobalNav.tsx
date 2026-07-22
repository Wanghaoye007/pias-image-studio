import {
  Archive,
  BadgeCheck,
  Box,
  Coins,
  FolderKanban,
  Gauge,
  Image,
  LogOut,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import type { ActiveAuthSession } from '../auth/authClient';
import type { AuthRole } from '../../shared/auth/types';
import type { StudioState } from '../../shared/domain';

export type NavKey = 'dashboard' | 'projects' | 'studio' | 'assets' | 'reviews' | 'usage' | 'admin';

type NavItem = {
  key: NavKey;
  label: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { key: 'dashboard', label: '首页', icon: Gauge },
  { key: 'projects', label: '项目', icon: FolderKanban },
  { key: 'studio', label: '图片工作台', icon: Image },
  { key: 'assets', label: '素材库', icon: Archive },
  { key: 'reviews', label: '审核', icon: BadgeCheck },
  { key: 'usage', label: '用量', icon: Coins },
  { key: 'admin', label: '企业管理', icon: ShieldCheck },
];

export function GlobalNav({
  activeNav,
  authSession,
  onLogout,
  onNavigate,
  state,
}: {
  activeNav: NavKey;
  authSession: ActiveAuthSession;
  onLogout: () => Promise<void>;
  onNavigate: (key: NavKey) => void;
  state: StudioState;
}) {
  const authenticated = authSession.status === 'authenticated';
  return (
    <aside className="nav-rail">
      <div className="brand-mark">
        <Box aria-hidden="true" size={20} />
        <span>内容工作台</span>
      </div>
      <nav aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              aria-current={activeNav === item.key ? 'page' : undefined}
              className={activeNav === item.key ? 'is-active' : ''}
              key={item.key}
              onClick={() => onNavigate(item.key)}
              title={item.label}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
            </button>
          );
        })}
      </nav>
      <div className="tenant-block">
        <div>
          <strong>{authenticated ? authSession.user.displayName : displayTenantName(state.tenantName)}</strong>
          <small>{authenticated ? roleLabel(authSession.user.role) : '本机开发模式'}</small>
        </div>
        {authenticated && (
          <button aria-label="退出登录" onClick={() => void onLogout()} title="退出登录" type="button">
            <LogOut aria-hidden="true" size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}

export function roleLabel(role: AuthRole): string {
  return ({
    owner: '企业所有者',
    admin: '企业管理员',
    creator: '内容创作者',
    reviewer: '内容审核员',
    viewer: '只读成员',
    platform_operator: '平台运营',
  } as Record<string, string>)[role] ?? '企业成员';
}

function displayTenantName(tenantName: string) {
  return tenantName === 'Aster Japan' ? 'Aster 日本' : tenantName;
}
