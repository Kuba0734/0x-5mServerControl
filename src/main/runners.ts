import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { Profile } from '../shared/types';
import { remoteFor } from './connections';
import { psq, sh, type RemoteHost } from './hosts';
import { parseLinuxStat, parseSamples, sampleProcesses, treeTotals, windowsSampleCommand } from './stats';
import { serverBinary } from './validate';

export interface Sample {
  cpu: number;
  memory: number;
  cores: number;
}

export interface Runner {
  onLine: (text: string, err: boolean) => void;
  onExit: (code: number | null) => void;
  start(): Promise<{ pid: number; startedAt: number }>;
  send(command: string): Promise<void>;
  kill(): Promise<void>;
  sample(): Promise<Sample | undefined>;
  describe(): string;
}

function launchArgs(profile: Profile, txDataPath: string) {
  return profile.mode === 'txadmin' ? ['+set', 'txAdminPort', String(profile.txAdminPort), '+set', 'txDataPath', txDataPath] : ['+exec', 'server.cfg'];
}

export class LocalRunner implements Runner {
  onLine: Runner['onLine'] = () => {};
  onExit: Runner['onExit'] = () => {};
  private proc?: ChildProcessWithoutNullStreams;
  private partial = { out: '', err: '' };
  private args: string[];
  private exe: string;
  private cwd: string;

  constructor(profile: Profile) {
    this.exe = path.join(profile.artifactsPath, 'FXServer.exe');
    this.args = launchArgs(profile, path.join(app.getPath('userData'), 'txData', profile.id));
    this.cwd = profile.mode === 'txadmin' ? profile.artifactsPath : profile.serverDataPath;
  }

  describe() {
    return `${this.exe} ${this.args.join(' ')}`;
  }

  private data(key: 'out' | 'err', chunk: string) {
    const parts = (this.partial[key] + chunk).split('\n');
    this.partial[key] = parts.pop() ?? '';
    for (const part of parts) this.onLine(part.replace(/\r$/, ''), key === 'err');
  }

  async start() {
    const proc = spawn(this.exe, this.args, { cwd: this.cwd, windowsHide: true });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.data('out', chunk));
    proc.stderr.on('data', (chunk: string) => this.data('err', chunk));
    proc.stdin.on('error', () => {});
    proc.on('error', (error) => this.onLine(`Process error: ${error.message}`, true));
    proc.on('close', (code) => {
      for (const key of ['out', 'err'] as const) if (this.partial[key]) this.data(key, '\n');
      this.proc = undefined;
      this.onExit(code);
    });
    return { pid: proc.pid ?? 0, startedAt: Date.now() };
  }

  async send(command: string) {
    if (!this.proc) throw new Error('Server is not running');
    this.proc.stdin.write(command + '\n');
  }

  kill() {
    const pid = this.proc?.pid;
    return new Promise<void>((resolve) => (pid ? execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()) : resolve()));
  }

  async sample() {
    const pid = this.proc?.pid;
    if (!pid) return undefined;
    return { ...treeTotals(await sampleProcesses(), pid), cores: os.cpus().length };
  }
}

const WRAPPER = String.raw`$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content -Raw -LiteralPath (Join-Path $dir 'config.json') | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Threading;
public static class FxscPump {
  public static void Start(TextReader reader, TextWriter writer) {
    var thread = new Thread(() => { string line; while ((line = reader.ReadLine()) != null) { writer.WriteLine(line); writer.Flush(); } });
    thread.IsBackground = true;
    thread.Start();
  }
}
'@
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cfg.exe
$psi.Arguments = $cfg.args
$psi.WorkingDirectory = $cfg.cwd
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [Text.Encoding]::UTF8
$log = New-Object System.IO.StreamWriter((Join-Path $dir 'console.log'), $true, (New-Object System.Text.UTF8Encoding $false))
$writer = [IO.TextWriter]::Synchronized($log)
$p = [Diagnostics.Process]::Start($psi)
[FxscPump]::Start($p.StandardOutput, $writer)
[FxscPump]::Start($p.StandardError, $writer)
while (-not $p.HasExited) {
  Get-ChildItem -LiteralPath $dir -Filter 'cmd-*.txt' | Sort-Object Name | ForEach-Object {
    $text = Get-Content -Raw -LiteralPath $_.FullName
    Remove-Item -LiteralPath $_.FullName
    $p.StandardInput.Write($text)
    $p.StandardInput.Flush()
  }
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 500
$writer.Flush()
$log.Close()
`;

const TAIL_MAX = 1024 * 1024;

export class RemoteRunner implements Runner {
  onLine: Runner['onLine'] = () => {};
  onExit: Runner['onExit'] = () => {};
  private pid = 0;
  private offset = 0;
  private partial = '';
  private tailTimer?: NodeJS.Timeout;
  private tailing = false;
  private session: string;

  constructor(private profile: Profile) {
    this.session = `fxsc-${profile.id}`;
  }

  describe() {
    return `${this.profile.host?.username}@${this.profile.host?.address}: ${this.profile.host?.os === 'linux' ? `screen ${this.session}` : 'FXServer wrapper'}`;
  }

  private host() {
    return remoteFor(this.profile);
  }

  private dir(host: RemoteHost) {
    return host.path.join(host.home, '.fxsc', this.profile.id);
  }

  async start() {
    const host = await this.host();
    const dir = this.dir(host);
    const log = host.path.join(dir, 'console.log');
    await host.mkdirp(dir);
    await host.writeText(log, '');
    const exe = serverBinary(host, this.profile.artifactsPath);
    const args = launchArgs(this.profile, host.path.join(dir, 'txData'));
    const cwd = this.profile.mode === 'txadmin' ? this.profile.artifactsPath : this.profile.serverDataPath;
    if (host.os === 'linux') {
      const inner = `bash ${sh(exe)} ${args.map(sh).join(' ')} 2>&1 | tee -a ${sh(log)}`;
      await host.run(`cd ${sh(cwd)} && screen -dmS ${this.session} bash -c ${sh(inner)}`);
      const list = await host.exec('screen -ls');
      this.pid = Number(list.stdout.match(new RegExp(`(\\d+)\\.${this.session}\\b`))?.[1] ?? 0);
    } else {
      const wrapper = host.path.join(dir, 'wrapper.ps1');
      await host.writeText(wrapper, WRAPPER);
      await host.writeText(
        host.path.join(dir, 'config.json'),
        JSON.stringify({ exe: host.native(exe), args: args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '), cwd: host.native(cwd) }),
      );
      const commandLine = `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${host.native(wrapper)}"`;
      const out = await host.run(`(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psq(commandLine)}; CurrentDirectory = ${psq(host.native(cwd))} }).ProcessId`);
      this.pid = Number(out.trim());
    }
    if (!this.pid) throw new Error('The server process could not be started on the remote host');
    const startedAt = Date.now();
    await host.writeText(host.path.join(dir, 'state.json'), JSON.stringify({ pid: this.pid, startedAt }));
    this.offset = 0;
    this.startTail();
    return { pid: this.pid, startedAt };
  }

  async attach() {
    const host = await this.host();
    const dir = this.dir(host);
    const state = JSON.parse(await host.readText(host.path.join(dir, 'state.json')).catch(() => '{}'));
    if (!state.pid) return undefined;
    this.pid = state.pid;
    const samples = await this.samples(host);
    if (!samples.has(this.pid)) return undefined;
    const size = (await host.stat(host.path.join(dir, 'console.log')))?.size ?? 0;
    this.offset = Math.max(0, size - 256 * 1024);
    this.startTail();
    return { pid: this.pid, startedAt: Number(state.startedAt) || Date.now() };
  }

  private startTail() {
    clearInterval(this.tailTimer);
    this.partial = '';
    this.tailTimer = setInterval(() => this.tail(), 500);
  }

  private async tail() {
    if (this.tailing) return;
    this.tailing = true;
    try {
      const host = await this.host();
      const log = host.path.join(this.dir(host), 'console.log');
      const size = (await host.stat(log))?.size ?? 0;
      if (size < this.offset) this.offset = 0;
      if (size > this.offset) {
        const chunk = await host.readFrom(log, this.offset, Math.min(size - this.offset, TAIL_MAX));
        this.offset += chunk.length;
        const parts = (this.partial + chunk.toString('utf8')).split('\n');
        this.partial = parts.pop() ?? '';
        for (const part of parts) this.onLine(part.replace(/\r$/, ''), false);
      }
    } catch {
    } finally {
      this.tailing = false;
    }
  }

  async send(command: string) {
    const host = await this.host();
    if (host.os === 'linux') {
      const escaped = command.replace(/\\/g, '\\\\').replace(/\^/g, '\\^');
      await host.run(`screen -S ${this.session} -p 0 -X stuff ${sh(escaped + '\r')}`);
      return;
    }
    const dir = this.dir(host);
    const name = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await host.writeText(host.path.join(dir, `${name}.tmp`), command + '\n');
    await host.rename(host.path.join(dir, `${name}.tmp`), host.path.join(dir, `${name}.txt`));
  }

  async kill() {
    const host = await this.host();
    if (host.os === 'windows') {
      await host.exec(`taskkill /PID ${this.pid} /T /F`);
      return;
    }
    const samples = await this.samples(host);
    const ids = [...samples.values()].filter((s) => s.pid !== this.pid && isDescendant(samples, s.pid, this.pid)).map((s) => s.pid);
    await host.exec(`screen -S ${this.session} -X quit; ${ids.length ? `kill -9 ${ids.join(' ')} 2>/dev/null` : 'true'}`);
  }

  private async samples(host: RemoteHost) {
    if (host.os === 'linux') return parseLinuxStat((await host.exec('cat /proc/[0-9]*/stat 2>/dev/null')).stdout);
    return parseSamples((await host.ps(windowsSampleCommand)).stdout.split(/\r?\n/));
  }

  async sample() {
    const host = await this.host();
    const samples = await this.samples(host);
    if (!samples.size) return undefined;
    if (!samples.has(this.pid)) {
      await this.tail();
      clearInterval(this.tailTimer);
      if (this.partial) this.onLine(this.partial, false);
      this.onExit(null);
      return undefined;
    }
    return { ...treeTotals(samples, this.pid), cores: host.cores };
  }

  detach() {
    clearInterval(this.tailTimer);
  }
}

function isDescendant(samples: Map<number, { ppid: number }>, pid: number, root: number) {
  for (let current = samples.get(pid), depth = 0; current && depth < 64; current = samples.get(current.ppid), depth++) if (current.ppid === root) return true;
  return false;
}

export function createRunner(profile: Profile): Runner {
  return profile.host ? new RemoteRunner(profile) : new LocalRunner(profile);
}
