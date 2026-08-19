import { getAppConfig } from '../config.js';
import { recordOperation } from '../repository.js';
import { syncPaymentStatuses } from './payment-status-sync.js';

let timer = null;
let running = false;
const state = {
  enabled: false,
  running: false,
  schedule: '每天 00:00',
  nextRunAt: '',
  lastRunAt: '',
  lastSuccessAt: '',
  lastErrorAt: '',
  lastError: '',
  lastResult: null
};

export function startPaymentStatusScheduler() {
  const config = getAppConfig().paymentStatusSync;
  state.enabled = config.enabled;
  if (timer) clearTimeout(timer);
  timer = null;
  if (!config.enabled) {
    state.nextRunAt = '';
    return getPaymentStatusSchedulerStatus();
  }
  scheduleNextMidnight();
  return getPaymentStatusSchedulerStatus();
}

export function getPaymentStatusSchedulerStatus() {
  return structuredClone(state);
}

export async function runPaymentStatusSyncOnce(trigger = 'manual') {
  if (running) throw new Error('payment status sync is already in progress');
  running = true;
  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = '';
  recordOperation('PAYMENT_STATUS_SYNC_START', 'SUCCESS', { trigger });
  try {
    const config = getAppConfig().paymentStatusSync;
    const result = await syncPaymentStatuses({ orgNumber: config.orgNumber });
    state.lastSuccessAt = new Date().toISOString();
    state.lastResult = {
      totalCount: result.totalCount,
      syncedCount: result.syncedCount,
      alreadyPaidCount: result.alreadyPaidCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount
    };
    return { status: getPaymentStatusSchedulerStatus(), result };
  } catch (error) {
    state.lastErrorAt = new Date().toISOString();
    state.lastError = error.message;
    recordOperation('PAYMENT_STATUS_SYNC_ERROR', 'FAILED', { trigger, message: error.message });
    throw error;
  } finally {
    running = false;
    state.running = false;
  }
}

export function stopPaymentStatusSchedulerForTest() {
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
  state.running = false;
  state.nextRunAt = '';
}

function scheduleNextMidnight() {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  state.nextRunAt = next.toISOString();
  timer = setTimeout(async () => {
    try {
      await runPaymentStatusSyncOnce('midnight');
    } catch (error) {
      console.error(`scheduled ERP payment status sync failed: ${error.message}`);
    } finally {
      if (state.enabled) scheduleNextMidnight();
    }
  }, Math.max(1000, next.getTime() - Date.now()));
  timer.unref?.();
}
