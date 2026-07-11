import { getAppConfig, getSanitizedConfigSummary } from '../config.js';
import { getDashboardSummary } from '../repository.js';
import { getSchedulerStatus } from './scheduler.js';

export function getSystemStatus() {
  const config = getAppConfig();
  return {
    productName: 'Fenbeitong Kingdee Voucher Integration',
    mode: {
      fenbeitong: config.fenbeitong.mode,
      kingdee: config.kingdee.mode
    },
    readiness: {
      fenbeitong: readiness(config.fenbeitong.mode, [
        ['FENBEITONG_BASE_URL', config.fenbeitong.baseUrl],
        ['FENBEITONG_ACCESS_TOKEN', config.fenbeitong.accessToken],
        ['FENBEITONG_PULL_PATH', config.fenbeitong.pullPath]
      ]),
      kingdee: readiness(config.kingdee.mode, [
        ['KINGDEE_SAVE_URL', config.kingdee.saveUrl]
      ])
    },
    summary: getDashboardSummary(),
    config: getSanitizedConfigSummary(),
    scheduler: getSchedulerStatus()
  };
}

export function getReadinessStatus() {
  const status = getSystemStatus();
  return {
    ready: status.readiness.fenbeitong.ready && status.readiness.kingdee.ready,
    dependencies: status.readiness,
    mode: status.mode
  };
}

function readiness(mode, fields) {
  if (mode === 'mock') {
    return {
      ready: true,
      message: 'mock mode enabled',
      missing: []
    };
  }
  const missing = fields.filter(([, value]) => !value).map(([name]) => name);
  return {
    ready: missing.length === 0,
    message: missing.length === 0 ? 'real mode configured' : `missing ${missing.join(', ')}`,
    missing
  };
}
