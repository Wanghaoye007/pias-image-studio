export type ReleasePreflightCheck = {
  id: string;
  status: 'pass' | 'fail';
  code: string;
};

export type ReleasePreflightReport = {
  schemaVersion: 1;
  target: 'production';
  checkedAt: string;
  ok: boolean;
  blockers: string[];
  checks: ReleasePreflightCheck[];
};

export type BillingAccessResult = {
  ok: boolean;
  status: number | null;
  reason: string;
};

export type ReleasePreflightOptions = {
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  billingCheck?: (options: { env: NodeJS.ProcessEnv }) => Promise<BillingAccessResult>;
};

export function runReleasePreflight(
  options?: ReleasePreflightOptions,
): Promise<ReleasePreflightReport>;
