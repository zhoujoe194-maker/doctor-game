import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_UI_PORT, resolveUiPort } from '../scripts/ui-port.mjs';

test('uses the documented default UI port when the env var is absent', () => {
  assert.equal(DEFAULT_UI_PORT, 4173);
  assert.equal(resolveUiPort({}), 4173);
});

test('accepts isolated unprivileged integer ports', () => {
  assert.equal(resolveUiPort({ DOCTORGAME_UI_PORT: '4271' }), 4271);
  assert.equal(resolveUiPort({ DOCTORGAME_UI_PORT: '65535' }), 65535);
});

test('rejects malformed, privileged and out-of-range ports clearly', () => {
  for (const value of ['', ' ', 'abc', '4271.5', '04271x', '80', '1023', '65536', ' 4271', '4271 ']) {
    assert.throws(() => resolveUiPort({ DOCTORGAME_UI_PORT: value }), /DOCTORGAME_UI_PORT 必须是 1024–65535 的整数/);
  }
});
