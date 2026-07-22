import type { AuthRole } from '../auth/types';

export type OrganizationProject = {
  id: string;
  tenantId: string;
  name: string;
  defaultBrand?: string;
  defaultSku?: string;
  ownerUserId: string;
  reviewRequired: boolean;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type OrganizationInvitation = {
  id: string;
  tenantId: string;
  email: string;
  displayName?: string;
  role: Exclude<AuthRole, 'owner' | 'platform_operator'>;
  projectIds: string[];
  status: 'pending' | 'accepted' | 'canceled' | 'expired';
  deliveryStatus: 'pending_configuration' | 'queued' | 'sent' | 'failed';
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  canceledAt?: string;
};

export type OrganizationInvitationPreview = Pick<
  OrganizationInvitation,
  'email' | 'displayName' | 'role' | 'expiresAt'
> & {
  projectIds: string[];
};

export type OrganizationInvitationDelivery = {
  enqueue(invitation: OrganizationInvitation, acceptToken: string, at: string): void;
  cancel(invitationId: string, at: string): void;
};

export type OrganizationMember = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: Exclude<AuthRole, 'owner' | 'platform_operator'>;
  status: 'active' | 'disabled';
  projectIds: string[];
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  firstLoginAt?: string;
};
