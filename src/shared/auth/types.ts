export type AuthRole =
  | 'owner'
  | 'admin'
  | 'creator'
  | 'reviewer'
  | 'viewer'
  | 'platform_operator';

export type PublicAuthUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: AuthRole;
  projectIds: string[];
  mfaEnabled: boolean;
};
