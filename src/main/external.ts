import { execFile } from 'node:child_process';
import os from 'node:os';
import type { Profile } from '../shared/types';
import { remoteFor } from './connections';
import { isDescendant, remoteSamples, type Runner } from './runners';
import { sampleProcesses, treeTotals } from './stats';

export interface ExternalProcess {
  pid: number;
  startedAt: number;
}

interface Candidate extends ExternalProcess {
  ppid: number;
}

const WINDOWS_QUERY = `Get-CimInstance Win32_Process -Filter "Name='FXServer.exe'" | % { "$($_.ProcessId)|$($_.ParentProcessId)|$(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())|$($_.ExecutablePath)" }`;

function localPowershell(script: string) {
  return new Promise<string>((resolve, reject) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  );
}

function roots(candidates: Candidate[]): ExternalProcess[] {
  const ids = new Set(candidates.map((c) => c.pid));
  return candidates.filter((c) => !ids.has(c.ppid)).map(({ pid, startedAt }) => ({ pid, startedAt }));
}

export function matchWindows(output: string, artifactsPath: string): ExternalProcess[] {
  const dir = artifactsPath.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() + '\\';
  const candidates = output.split(/\r?\n/).flatMap((line) => {
    const [pid, ppid, startedAt, exe] = line.trim().split('|');
    return exe && exe.toLowerCase().startsWith(dir) ? [{ pid: Number(pid), ppid: Number(ppid), startedAt: Number(startedAt) || Date.now() }] : [];
  });
  return roots(candidates);
}

export function matchLinux(output: string, artifactsPath: string, now = Date.now()): ExternalProcess[] {
  const dir = artifactsPath.replace(/\/+$/, '') + '/';
  const candidates = output.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!match || !match[4].includes(dir) || !/\/FXServer(\s|$)/.test(match[4])) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), startedAt: now - Number(match[3]) * 1000 }];
  });
  return roots(candidates);
}

export async function findExternal(profile: Profile): Promise<ExternalProcess[]> {
  if (!profile.artifactsPath) return [];
  if (!profile.host) return matchWindows(await localPowershell(WINDOWS_QUERY), profile.artifactsPath);
  const host = await remoteFor(profile);
  if (host.os === 'windows') return matchWindows((await host.ps(WINDOWS_QUERY)).stdout, profile.artifactsPath);
  return matchLinux((await host.exec('ps -eo pid=,ppid=,etimes=,args=')).stdout, profile.artifactsPath);
}

export class ExternalRunner implements Runner {
  onLine: Runner['onLine'] = () => {};
  onExit: Runner['onExit'] = () => {};

  constructor(
    private profile: Profile,
    private process: ExternalProcess,
  ) {}

  describe() {
    return `FXServer process ${this.process.pid} started outside the app`;
  }

  async start() {
    return { pid: this.process.pid, startedAt: this.process.startedAt };
  }

  async send(): Promise<void> {
    throw new Error('This server was started outside the app, so commands are not available');
  }

  async kill() {
    const pid = this.process.pid;
    if (!this.profile.host) {
      await new Promise<void>((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()));
      return;
    }
    const host = await remoteFor(this.profile);
    if (host.os === 'windows') {
      await host.exec(`taskkill /PID ${pid} /T /F`);
      return;
    }
    const samples = await remoteSamples(host);
    const ids = [pid, ...[...samples.values()].filter((s) => isDescendant(samples, s.pid, pid)).map((s) => s.pid)].join(' ');
    await host.exec(`kill -TERM ${ids} 2>/dev/null; sleep 5; kill -9 ${ids} 2>/dev/null; true`);
  }

  async sample() {
    const remote = this.profile.host ? await remoteFor(this.profile) : undefined;
    const samples = remote ? await remoteSamples(remote) : await sampleProcesses();
    if (!samples.size) return undefined;
    if (!samples.has(this.process.pid)) {
      this.onExit(null);
      return undefined;
    }
    return { ...treeTotals(samples, this.process.pid), cores: remote ? remote.cores : os.cpus().length };
  }
}
