import { getAppConfig } from '../config.js';
import { getConfig, recordOperation } from '../repository.js';
import { pushVoucherToErp, syncFenbeitongDocuments } from './voucher-workflow.js';

let timer = null;
let running = false;
const schedulerState = {
  enabled: false,
  intervalSeconds: 3600,
  autoPushErp: false,
  running: false,
  lastRunAt: '',
  lastSuccessAt: '',
  lastErrorAt: '',
  lastError: '',
  lastBatchId: '',
  runCount: 0
};

export function startScheduler() {
  const config = getAppConfig().scheduler;
  schedulerState.enabled = config.enabled;
  schedulerState.intervalSeconds = config.intervalSeconds;
  schedulerState.autoPushErp = config.autoPushErp;

  if (!config.enabled) {
    recordOperation('SCHEDULER_DISABLED', 'SUCCESS', {
      intervalSeconds: config.intervalSeconds,
      autoPushErp: config.autoPushErp
    });
    return getSchedulerStatus();
  }

  if (timer) {
    clearInterval(timer);
  }
  timer = setInterval(() => {
    runSchedulerOnce('timer').catch((error) => {
      console.error(`scheduled Fenbeitong sync failed: ${error.message}`);
    });
  }, config.intervalSeconds * 1000);
  timer.unref?.();
  recordOperation('SCHEDULER_STARTED', 'SUCCESS', {
    intervalSeconds: config.intervalSeconds,
    autoPushErp: config.autoPushErp
  });
  return getSchedulerStatus();
}

export function stopSchedulerForTest() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  schedulerState.running = false;
}

export function getSchedulerStatus() {
  return structuredClone(schedulerState);
}

export async function runSchedulerOnce(trigger = 'manual') {
  if (running) {
    throw new Error('scheduler run is already in progress');
  }
  running = true;
  schedulerState.running = true;
  schedulerState.lastRunAt = now();
  schedulerState.lastError = '';
  schedulerState.runCount += 1;
  recordOperation('SCHEDULER_RUN_START', 'SUCCESS', { trigger });

  try {
    const syncResult = await syncFenbeitongDocuments();
    schedulerState.lastBatchId = syncResult.batch.batchId;
    const pushed = [];

    if (schedulerState.autoPushErp) {
      const voucherConfig = getConfig();
      if (!voucherConfig) {
        throw new Error('scheduler auto push requires saved voucher configuration');
      }
      for (const record of syncResult.records) {
        pushed.push(await pushVoucherToErp({
          sourceId: record.sourceId,
          voucherDate: currentDate(),
          year: new Date().getFullYear(),
          period: new Date().getMonth() + 1,
          config: voucherConfig
        }));
      }
    }

    schedulerState.lastSuccessAt = now();
    recordOperation('SCHEDULER_RUN_FINISH', 'SUCCESS', {
      trigger,
      batchId: syncResult.batch.batchId,
      syncedCount: syncResult.records.length,
      pushedCount: pushed.length
    });
    return {
      status: getSchedulerStatus(),
      sync: syncResult,
      pushed
    };
  } catch (error) {
    schedulerState.lastErrorAt = now();
    schedulerState.lastError = error.message;
    recordOperation('SCHEDULER_RUN_ERROR', 'FAILED', { trigger, message: error.message });
    throw error;
  } finally {
    running = false;
    schedulerState.running = false;
  }
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return new Date().toISOString();
}
