import test from 'node:test';
import assert from 'node:assert/strict';
import { inside, sh, psq, type Host } from '../main/hosts';
import { parseLinuxStat, treeTotals } from '../main/stats';
import path from 'node:path';

const posixHost = { path: path.posix } as Host;

test('keeps remote paths inside the root', () => {
  assert.equal(inside(posixHost, '/srv/data', 'resources/a'), '/srv/data/resources/a');
  assert.equal(inside(posixHost, 'C:/FX/data', 'x'), 'C:/FX/data/x');
  assert.equal(inside(posixHost, '/srv/data', ''), '/srv/data');
  assert.throws(() => inside(posixHost, '/srv/data', '../etc'));
  assert.throws(() => inside(posixHost, 'C:/FX/data', 'a/../../x'));
  assert.throws(() => inside(posixHost, '/srv/data', '../data2'));
});

test('quotes shell arguments', () => {
  assert.equal(sh("it's"), `'it'\\''s'`);
  assert.equal(psq("it's"), `'it''s'`);
});

test('parses linux proc stat into a process tree', () => {
  const stat = [
    '100 (SCREEN) S 1 100 100 0 -1 4194560 0 0 0 0 10 5 0 0 20 0 1 0 1 1000 50 0',
    '101 (bash -c x) S 100 101 101 0 -1 4194560 0 0 0 0 1 1 0 0 20 0 1 0 1 1000 25 0',
    '102 (FXServer) S 101 101 101 0 -1 4194560 0 0 0 0 300 100 0 0 20 0 1 0 1 1000 1000 0',
    '200 (other) S 1 200 200 0 -1 4194560 0 0 0 0 999 999 0 0 20 0 1 0 1 1000 1000 0',
  ].join('\n');
  const samples = parseLinuxStat(stat);
  assert.equal(samples.get(102)?.ppid, 101);
  const totals = treeTotals(samples, 100);
  assert.equal(totals.cpu, (15 + 2 + 400) * 1e5);
  assert.equal(totals.memory, (50 + 25 + 1000) * 4096);
});
