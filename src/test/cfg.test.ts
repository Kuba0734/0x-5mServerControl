import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPlaceholders, getEnsureList, readLicenseKey, readPort, setEnsureOrder } from '../main/cfg';
import { parseLine } from '../shared/colors';

const cfg = 'endpoint_add_tcp "0.0.0.0:30125"\r\nsv_licenseKey "abc123"\r\nensure chat # keep\r\n# ensure skipped\r\nstart [ox]\r\nensure map';

test('reads license key and port', () => {
  assert.equal(readLicenseKey(cfg), 'abc123');
  assert.equal(readLicenseKey('sv_licenseKey "{{svLicense}}"'), '');
  assert.equal(readLicenseKey('sv_licenseKey changeme'), '');
  assert.equal(readPort(cfg), 30125);
});

test('reorders ensure lines in place', () => {
  assert.deepEqual(getEnsureList(cfg), ['chat', '[ox]', 'map']);
  const next = setEnsureOrder(cfg, ['map', 'chat', '[ox]']);
  assert.equal(next, 'endpoint_add_tcp "0.0.0.0:30125"\r\nsv_licenseKey "abc123"\r\nensure map\r\n# ensure skipped\r\nensure chat # keep\r\nstart [ox]');
  assert.throws(() => setEnsureOrder(cfg, ['map']));
});

test('fills placeholders', () => {
  assert.equal(fillPlaceholders('a {{x}} {{ y }} {{z}}', { x: '1', y: '2' }), 'a 1 2 {{z}}');
});

test('parses color codes', () => {
  assert.deepEqual(parseLine('^1red^7white'), [{ text: 'red', color: 1 }, { text: 'white', color: 7 }]);
  assert.deepEqual(parseLine('\x1b[31mred\x1b[0m plain'), [{ text: 'red', color: 1 }, { text: ' plain', color: -1 }]);
  assert.deepEqual(parseLine('\x1b[38;5;31mx\x1b[32my'), [{ text: 'x', color: -1 }, { text: 'y', color: 2 }]);
});
