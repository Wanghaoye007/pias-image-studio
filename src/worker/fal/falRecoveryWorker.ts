import type { FalQueueService } from './falQueueService';

type RecoverableFalService = Pick<FalQueueService, 'listRecoverableJobs' | 'status'>
  & Partial<Pick<FalQueueService, 'listBillingPendingJobs' | 'reconcileBilling'>>;

export type FalRecoveryCycleReport = {
  inspected: number;
  advanced: number;
  billingInspected: number;
  billingConfirmed: number;
  failed: Array<{ requestId: string; message: string }>;
};

export async function runFalRecoveryCycle(
  service: RecoverableFalService,
): Promise<FalRecoveryCycleReport> {
  const requestIds = await service.listRecoverableJobs();
  const report: FalRecoveryCycleReport = {
    inspected: requestIds.length,
    advanced: 0,
    billingInspected: 0,
    billingConfirmed: 0,
    failed: [],
  };
  for (const requestId of requestIds) {
    try {
      await service.status(requestId);
      report.advanced += 1;
    } catch (error) {
      report.failed.push({
        requestId,
        message: error instanceof Error ? error.message : 'Fal 恢复失败',
      });
    }
  }
  if (service.listBillingPendingJobs && service.reconcileBilling) {
    const billingRequestIds = await service.listBillingPendingJobs();
    report.billingInspected = billingRequestIds.length;
    for (const requestId of billingRequestIds) {
      try {
        if (await service.reconcileBilling(requestId) === 'confirmed') {
          report.billingConfirmed += 1;
        }
      } catch (error) {
        report.failed.push({
          requestId,
          message: error instanceof Error ? error.message : 'Fal 账单对账失败',
        });
      }
    }
  }
  return report;
}

export function createFalRecoveryWorker(options: {
  listServices(): Promise<RecoverableFalService[]> | RecoverableFalService[];
  intervalMs?: number;
  onError?: (error: unknown) => void;
}) {
  const intervalMs = Math.max(250, options.intervalMs ?? 2_500);
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<FalRecoveryCycleReport[]> | undefined;
  let stopped = false;

  const runOnce = (): Promise<FalRecoveryCycleReport[]> => {
    if (active) return active;
    active = Promise.resolve(options.listServices())
      .then(async (services) => {
        const reports: FalRecoveryCycleReport[] = [];
        for (const service of services) reports.push(await runFalRecoveryCycle(service));
        return reports;
      })
      .finally(() => {
        active = undefined;
      });
    return active;
  };

  return {
    runOnce,
    start() {
      if (timer || stopped) return;
      void runOnce().catch(options.onError ?? (() => undefined));
      timer = setInterval(() => {
        void runOnce().catch(options.onError ?? (() => undefined));
      }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await active?.catch(() => undefined);
    },
  };
}
