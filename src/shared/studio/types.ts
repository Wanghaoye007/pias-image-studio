import type { StudioState } from '../domain';

export type PersistedStudioSnapshot = {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  state: StudioState;
};

export type StudioStateScope = {
  tenantId: string;
  projectId: string;
};
