import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('public deployment starts the authenticated integrated entry', () => {
  const service = readFileSync('deploy/fenbeittong-frontend.service', 'utf8');
  const installer = readFileSync('deploy/install-release.sh', 'utf8');

  assert.match(service, /Environment=FENBEITONG_ASSISTANT_HOST=0\.0\.0\.0/);
  assert.match(service, /Environment=FENBEITONG_ASSISTANT_PORT=18734/);
  assert.match(service, /Environment=FENBEITONG_ASSISTANT_TICKET_VALIDATE_URL=/);
  assert.match(service, /ExecStart=.*\/node server\.js/);
  assert.doesNotMatch(service, /frontend\/server\.js/);
  assert.doesNotMatch(service, /Requires=fenbeittong-backend\.service/);

  assert.match(installer, /fenbeittong-frontend\.service/);
  assert.doesNotMatch(installer, /install -m 0644 .*fenbeittong-backend\.service/);
  assert.doesNotMatch(installer, /systemctl enable .*fenbeittong-backend\.service/);
});
