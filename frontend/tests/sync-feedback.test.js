import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync('frontend/src/app.js', 'utf8');
const syncFunction = source.slice(
  source.indexOf('async function syncFenbeitong()'),
  source.indexOf('async function syncPaymentStatusesToFenbeitong()')
);

function harness() {
  let resolveRequest, rejectRequest;
  const request = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const feedback = [], completed = [], renderedBusyStates = [], timers = new Map();
  let calls = 0, refreshed = 0, now = 1000;
  const context = vm.createContext({
    state: { syncRunning: false, selectedTenantKey: 'puhui' },
    Date: { now: () => now },
    isSelectedTenantWaiting: () => false,
    api: { syncFenbeitong: () => { calls += 1; return request; } },
    showOperationFeedback: message => feedback.push(message),
    renderActionState: () => renderedBusyStates.push(context.state.syncRunning),
    setInterval: callback => { timers.set(1, callback); return 1; },
    clearInterval: id => timers.delete(id),
    selectFirstRecord: () => {},
    invalidatePreview: () => {},
    refreshAll: async () => { refreshed += 1; },
    show: (_result, message) => completed.push(message)
  });
  vm.runInContext(syncFunction, context);
  return { context, feedback, completed, renderedBusyStates, timers, resolveRequest, rejectRequest,
    calls: () => calls, refreshed: () => refreshed, advance: ms => { now += ms; } };
}

test('sync reports waiting immediately and rejects duplicate clicks while its request is pending', async () => {
  const h = harness();
  const first = h.context.syncFenbeitong();
  assert.equal(h.context.state.syncRunning, true);
  assert.match(h.feedback[0], /正在同步分贝通，已等待 0 秒/);
  assert.deepEqual(h.renderedBusyStates, [true]);
  h.advance(82000);
  h.timers.get(1)();
  assert.match(h.feedback.at(-1), /已等待 82 秒/);
  await h.context.syncFenbeitong();
  assert.equal(h.calls(), 1);
  h.resolveRequest({ records: [] });
  await first;
  assert.equal(h.refreshed(), 1);
  assert.match(h.completed[0], /同步完成.*0 张/);
  assert.equal(h.context.state.syncRunning, false);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.renderedBusyStates, [true, false]);
});

test('sync failure propagates to the existing error display and releases the busy state and timer', async () => {
  const h = harness();
  const running = h.context.syncFenbeitong();
  h.rejectRequest(new Error('upstream unavailable'));
  await assert.rejects(running, /upstream unavailable/);
  assert.equal(h.context.state.syncRunning, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.refreshed(), 0);
  assert.equal(h.completed.length, 0);
  assert.deepEqual(h.renderedBusyStates, [true, false]);
});

test('every sync entry respects the busy state and the visible button exposes it accessibly', () => {
  assert.match(source, /controls\.syncFenbeitong\.disabled = tenantWaiting \|\| state\.syncRunning/);
  assert.match(source, /controls\.sync\.disabled = tenantWaiting \|\| state\.syncRunning/);
  assert.match(source, /controls\.primaryAction\.disabled = \(tenantWaiting \|\| state\.syncRunning\)/);
  assert.match(source, /controls\.syncFenbeitong\.setAttribute\('aria-busy', String\(state\.syncRunning\)\)/);
});
