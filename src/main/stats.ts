import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface ProcSample {
  pid: number;
  ppid: number;
  cpu: number;
  memory: number;
}

const script = "Get-CimInstance Win32_Process | % { \"$($_.ProcessId) $($_.ParentProcessId) $($_.KernelModeTime + $_.UserModeTime) $($_.WorkingSetSize)\" }; '__END__'\n";
export const windowsSampleCommand = script.replace("; '__END__'\n", '');

let shell: ChildProcessWithoutNullStreams | undefined;
let buffer = '';
let pending: ((lines: string[]) => void) | undefined;

function ensureShell() {
  if (shell && shell.exitCode === null) return shell;
  shell = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true });
  shell.stdout.setEncoding('utf8');
  shell.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const end = buffer.indexOf('__END__');
    if (end === -1) return;
    const lines = buffer.slice(0, end).split(/\r?\n/);
    buffer = buffer.slice(end + 7);
    pending?.(lines);
    pending = undefined;
  });
  shell.on('exit', () => {
    pending?.([]);
    pending = undefined;
    shell = undefined;
  });
  return shell;
}

let inflight: Promise<Map<number, ProcSample>> | undefined;

export function parseSamples(lines: string[]) {
  const map = new Map<number, ProcSample>();
  for (const line of lines) {
    const [pid, ppid, cpu, memory] = line.trim().split(' ').map(Number);
    if (pid) map.set(pid, { pid, ppid, cpu, memory });
  }
  return map;
}

export function parseLinuxStat(text: string, pageSize = 4096) {
  const map = new Map<number, ProcSample>();
  for (const line of text.split('\n')) {
    const close = line.lastIndexOf(')');
    if (close < 0) continue;
    const pid = Number(line.slice(0, line.indexOf(' ')));
    const rest = line.slice(close + 2).split(' ');
    const ticks = Number(rest[11]) + Number(rest[12]);
    if (pid) map.set(pid, { pid, ppid: Number(rest[1]), cpu: ticks * 1e5, memory: Number(rest[21]) * pageSize });
  }
  return map;
}

export function sampleProcesses() {
  inflight ??= new Promise<Map<number, ProcSample>>((resolve) => {
    pending = (lines) => {
      inflight = undefined;
      resolve(parseSamples(lines));
    };
    ensureShell().stdin.write(script);
  });
  return inflight;
}

export function treeTotals(samples: Map<number, ProcSample>, root: number) {
  const ids = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of samples.values()) {
      if (!ids.has(s.pid) && ids.has(s.ppid)) {
        ids.add(s.pid);
        grew = true;
      }
    }
  }
  let cpu = 0;
  let memory = 0;
  for (const id of ids) {
    const s = samples.get(id);
    if (s) {
      cpu += s.cpu;
      memory += s.memory;
    }
  }
  return { cpu, memory };
}

export function stopShell() {
  shell?.kill();
}
