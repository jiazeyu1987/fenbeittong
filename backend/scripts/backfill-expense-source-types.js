import {
  queryKingdeeExpenseReimbursementHeaders,
  updateKingdeeExpenseReimbursementSourceType
} from '../src/adapters/kingdee-client.js';
import { listProcessRecords } from '../src/repository.js';

const SOURCE_LABELS = Object.freeze({
  OFFLINE_REIMBURSEMENT: '线下报销 · 费用明细',
  ONLINE_MONTHLY_BILL: '线上月结 · 企业账单'
});

const headers = await queryKingdeeExpenseReimbursementHeaders({ limit: 10000 });
const headersByFid = new Map(headers.map((row) => [String(row.FID), row]));
const candidates = listProcessRecords()
  .filter((record) => record.erpFid && SOURCE_LABELS[record.sourceType])
  .filter((record) => headersByFid.has(String(record.erpFid)))
  .filter((record) => !String(headersByFid.get(String(record.erpFid)).F_ora_Text_qtr || '').trim());

const result = { scanned: headers.length, candidates: candidates.length, updated: [], failed: [] };
for (const record of candidates) {
  const value = SOURCE_LABELS[record.sourceType];
  try {
    const update = await updateKingdeeExpenseReimbursementSourceType(record.erpFid, value, {
      accountKey: 'current',
      acctIdKey: record.kingdeeAcctIdKey
    });
    result.updated.push({
      erpFid: String(record.erpFid),
      erpNumber: String(record.erpNumber || ''),
      sourceTypeValue: update.sourceTypeValue
    });
  } catch (error) {
    result.failed.push({
      erpFid: String(record.erpFid),
      erpNumber: String(record.erpNumber || ''),
      code: String(error?.code || 'BACKFILL_FAILED'),
      message: String(error?.message || error)
    });
  }
}

console.log(JSON.stringify(result, null, 2));
if (result.failed.length > 0) process.exitCode = 1;
