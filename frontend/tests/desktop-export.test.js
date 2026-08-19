import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveCsvToDesktop } from '../src/desktop-export.js';

test('desktop export opens the save picker at the desktop and writes CSV content', async () => {
  const calls = [];
  const browser = {
    async showSaveFilePicker(options) {
      calls.push(options);
      return {
        name: '报销单.csv',
        async createWritable() {
          return {
            async write(content) { calls.push(content); },
            async close() { calls.push('closed'); }
          };
        }
      };
    }
  };
  const result = await saveCsvToDesktop({ filename: '报销单.csv', content: 'A,B' }, browser);
  assert.equal(calls[0].startIn, 'desktop');
  assert.equal(calls[1], 'A,B');
  assert.equal(calls[2], 'closed');
  assert.equal(result.localPath, '桌面/报销单.csv');
});

test('desktop export returns null when the browser does not support the save picker', async () => {
  assert.equal(await saveCsvToDesktop({ filename: 'a.csv', content: 'x' }, {}), null);
});

test('desktop export falls back to a native browser download', async () => {
  const events = [];
  const link = { hidden: false, click() { events.push('click'); }, remove() { events.push('remove'); } };
  const browser = { document: { createElement: () => link, body: { append: () => events.push('append') } } };
  const result = await saveCsvToDesktop({ filename: 'a.csv', content: 'A,B' }, browser);
  assert.deepEqual(events, ['append', 'click', 'remove']);
  assert.equal(link.download, 'a.csv');
  assert.equal(result.destination, 'browser-download');
});
