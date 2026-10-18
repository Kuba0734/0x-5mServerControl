import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import type { UpdateInfo } from '../shared/types';
import { download } from './net';

const RELEASES = 'https://api.github.com/repos/Kuba0734/0x-5mServerControl/releases/latest';

export function newer(latest: string, current: string) {
  const a = latest.replace(/^v/, '').split('.').map(Number);
  const b = current.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return false;
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const res = await fetch(RELEASES, { headers: { 'User-Agent': '0x-5mServerControl', Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return { current, latest: current, available: false };
  if (!res.ok) throw new Error(`Update check failed (${res.status})`);
  const release = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  const asset = release.assets.find((a) => a.name.toLowerCase().endsWith('.exe'));
  const latest = release.tag_name.replace(/^v/, '');
  return { current, latest, available: !!asset && newer(latest, current), url: asset?.browser_download_url };
}

export async function applyUpdate(url: string) {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!exe) throw new Error('Auto-update only works in the portable build');
  const next = exe + '.new';
  await download(url, next);
  const script = path.join(os.tmpdir(), `fxsc-update-${Date.now()}.cmd`);
  fs.writeFileSync(
    script,
    [
      '@echo off',
      'for /l %%i in (1,1,60) do (',
      `  move /y "${next}" "${exe}" >nul 2>&1 && goto done`,
      '  timeout /t 1 /nobreak >nul',
      ')',
      'exit /b 1',
      ':done',
      `start "" "${exe}"`,
      'del "%~f0"',
    ].join('\r\n'),
  );
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
