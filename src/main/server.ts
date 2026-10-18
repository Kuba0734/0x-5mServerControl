import type { ConsoleLine, Player, Profile, ServerState, Stats } from '../shared/types';
import { stripColors } from '../shared/colors';
import { broadcast, toast } from './bus';
import { effectivePort } from './cfg';
import { remoteFor } from './connections';
import { ExternalRunner, findExternal } from './external';
import { createRunner, RemoteRunner, type Runner } from './runners';
import { getProfile, getProfiles } from './store';
import { validate } from './validate';

const MAX_LINES = 5000;
const STOP_TIMEOUT = 10_000;
const CRASH_WINDOW = 5 * 60_000;
const MAX_RESTARTS = 3;

interface Instance {
  state: ServerState;
  runner?: Runner;
  starting: boolean;
  lines: ConsoleLine[];
  pending: ConsoleLine[];
  stopRequested: boolean;
  crashes: number[];
  started: Set<string>;
  players: Player[];
  stats: Stats;
  lastCpu?: { value: number; at: number };
  exited?: Promise<void>;
  sampling: boolean;
  checking: boolean;
  lastExit: number;
}

const instances = new Map<string, Instance>();
let sequence = 0;

function instance(id: string) {
  let inst = instances.get(id);
  if (!inst) {
    inst = {
      state: { profileId: id, status: 'stopped' },
      starting: false,
      lines: [],
      pending: [],
      stopRequested: false,
      crashes: [],
      started: new Set(),
      players: [],
      stats: { cpu: 0, memory: 0, uptime: 0, players: 0 },
      sampling: false,
      checking: false,
      lastExit: 0,
    };
    instances.set(id, inst);
  }
  return inst;
}

function setState(inst: Instance, patch: Partial<ServerState>) {
  inst.state = { ...inst.state, ...patch };
  broadcast('server:state', inst.state);
}

function pushLine(inst: Instance, text: string, err = false) {
  const line = { n: ++sequence, t: Date.now(), text, err };
  inst.lines.push(line);
  if (inst.lines.length > MAX_LINES) inst.lines.splice(0, inst.lines.length - MAX_LINES);
  inst.pending.push(line);
  const plain = stripColors(text);
  const started = plain.match(/Started resource (\S+)/);
  const stopped = plain.match(/Stopping resource (\S+)/);
  if (started) inst.started.add(started[1]);
  if (stopped) inst.started.delete(stopped[1]);
  if (started || stopped) broadcast('server:resources', inst.state.profileId);
}

setInterval(() => {
  for (const inst of instances.values()) {
    if (!inst.pending.length) continue;
    broadcast('server:console', inst.state.profileId, inst.pending);
    inst.pending = [];
  }
}, 50);

function bind(id: string, inst: Instance, runner: Runner) {
  inst.runner = runner;
  inst.stopRequested = false;
  inst.started.clear();
  inst.players = [];
  inst.lastCpu = undefined;
  runner.onLine = (text, err) => pushLine(inst, text, err);
  inst.exited = new Promise((resolve) => {
    runner.onExit = (code) => {
      if (inst.runner !== runner) return;
      inst.runner = undefined;
      inst.lastExit = Date.now();
      setState(inst, { status: 'stopped', pid: undefined, startedAt: undefined, external: false });
      broadcast('server:resources', id);
      resolve();
      if (runner instanceof ExternalRunner) pushLine(inst, 'The external server process has exited');
      else if (!inst.stopRequested) onCrash(id, code);
    };
  });
}

function sharesArtifacts(a: Profile, b: Profile) {
  return a.id !== b.id && a.artifactsPath === b.artifactsPath && a.host?.address === b.host?.address;
}

async function detectExternal(profile: Profile) {
  if (getProfiles().some((other) => sharesArtifacts(profile, other) && isRunning(other.id))) return undefined;
  return (await findExternal(profile))[0];
}

async function adoptExternal(id: string) {
  const inst = instance(id);
  if (inst.runner || inst.starting || inst.checking || Date.now() - inst.lastExit < 15_000) return;
  inst.checking = true;
  try {
    const profile = getProfile(id);
    const found = await detectExternal(profile);
    if (!found || inst.runner || inst.starting) return;
    const runner = new ExternalRunner(profile, found);
    bind(id, inst, runner);
    pushLine(inst, `> ${runner.describe()}. Console output and commands are only available for servers started by the app.`);
    setState(inst, { status: 'running', pid: found.pid, startedAt: found.startedAt, external: true });
  } catch {
  } finally {
    inst.checking = false;
  }
}

export function watchExternal() {
  const scan = () => getProfiles().forEach((p) => adoptExternal(p.id));
  scan();
  setInterval(scan, 5000);
}

export async function start(id: string) {
  const inst = instance(id);
  if (inst.runner || inst.starting) return inst.state;
  inst.starting = true;
  try {
    const profile = getProfile(id);
    const external = await detectExternal(profile).catch(() => undefined);
    if (external) throw new Error(`This server is already running outside the app (PID ${external.pid})`);
    const failed = (await validate(profile)).filter((issue) => !issue.ok);
    if (failed.length) throw new Error(failed.map((issue) => issue.label + (issue.detail && issue.label === 'SSH connection' ? `: ${issue.detail}` : '')).join(', ') + ' check failed');
    const runner = createRunner(profile);
    bind(id, inst, runner);
    pushLine(inst, `> ${runner.describe()}`);
    try {
      const { pid, startedAt } = await runner.start();
      setState(inst, { status: 'running', pid, startedAt, external: false });
    } catch (error) {
      inst.runner = undefined;
      throw error;
    }
    return inst.state;
  } finally {
    inst.starting = false;
  }
}

export async function attachRemote(id: string) {
  const inst = instance(id);
  if (inst.runner) return;
  const runner = new RemoteRunner(getProfile(id));
  const attached = await runner.attach();
  if (!attached) return runner.detach();
  bind(id, inst, runner);
  pushLine(inst, `> Attached to running server (${runner.describe()})`);
  setState(inst, { status: 'running', pid: attached.pid, startedAt: attached.startedAt, external: false });
}

export function detachRemote(id: string) {
  const inst = instance(id);
  if (inst.runner instanceof RemoteRunner) {
    inst.runner.detach();
    inst.runner = undefined;
    setState(inst, { status: 'stopped', pid: undefined, startedAt: undefined });
  }
}

function onCrash(id: string, code: number | null) {
  const inst = instance(id);
  const profile = getProfile(id);
  pushLine(inst, `Server exited unexpectedly${code === null ? '' : ` (code ${code})`}`, true);
  if (!profile.autoRestart) {
    toast('error', `${profile.name} crashed`);
    return;
  }
  const now = Date.now();
  inst.crashes = inst.crashes.filter((t) => now - t < CRASH_WINDOW);
  if (inst.crashes.length >= MAX_RESTARTS) {
    toast('error', `${profile.name} crashed ${MAX_RESTARTS} times in 5 minutes, auto-restart stopped`);
    return;
  }
  inst.crashes.push(now);
  toast('error', `${profile.name} crashed, restarting (${inst.crashes.length}/${MAX_RESTARTS})`);
  setTimeout(() => start(id).catch((error) => toast('error', error.message)), 2000);
}

export async function stop(id: string) {
  const inst = instance(id);
  const runner = inst.runner;
  if (!runner) return;
  inst.stopRequested = true;
  setState(inst, { status: 'stopping' });
  const external = runner instanceof ExternalRunner;
  if (!external) await runner.send('quit').catch(() => {});
  const timer = setTimeout(() => runner.kill().catch(() => {}), external ? 0 : STOP_TIMEOUT);
  const fallback = setTimeout(() => runner.onExit(null), STOP_TIMEOUT + 15_000);
  await inst.exited;
  clearTimeout(timer);
  clearTimeout(fallback);
}

export async function restart(id: string) {
  await stop(id);
  return start(id);
}

export async function sendCommand(id: string, command: string) {
  const inst = instance(id);
  if (!inst.runner) throw new Error('Server is not running');
  pushLine(inst, `> ${command}`);
  await inst.runner.send(command);
}

export function getConsole(id: string) {
  return instance(id).lines;
}

export function getStates() {
  return [...instances.values()].map((inst) => inst.state);
}

export function getStats(id: string) {
  return instance(id).stats;
}

export function getPlayers(id: string) {
  return instance(id).players;
}

export function startedResources(id: string) {
  return instance(id).started;
}

export function isRunning(id: string) {
  return !!instance(id).runner;
}

export function localRunning() {
  return getProfiles().some((p) => !p.host && isRunning(p.id) && !instance(p.id).state.external);
}

export async function stopLocal() {
  await Promise.all(getProfiles().filter((p) => !p.host && !instance(p.id).state.external).map((p) => stop(p.id)));
}

async function fetchPlayers(id: string) {
  const profile = getProfile(id);
  const port = await effectivePort(profile);
  if (!profile.host) {
    const res = await fetch(`http://127.0.0.1:${port}/players.json`, { signal: AbortSignal.timeout(2000) });
    return (await res.json()) as Player[];
  }
  const host = await remoteFor(profile);
  const result = await host.exec(`${host.os === 'windows' ? 'curl.exe' : 'curl'} -s -m 2 http://127.0.0.1:${port}/players.json`);
  return JSON.parse(result.stdout) as Player[];
}

async function pollPlayers(id: string, inst: Instance) {
  try {
    const list = await fetchPlayers(id);
    inst.players = list.map((p) => ({ id: p.id, name: p.name, ping: p.ping, identifiers: p.identifiers ?? [] }));
  } catch {
    inst.players = [];
  }
  broadcast('server:players', id, inst.players);
}

async function sample(id: string, inst: Instance) {
  if (inst.sampling || !inst.runner) return;
  inst.sampling = true;
  try {
    const totals = await inst.runner.sample();
    if (!totals || !inst.runner) return;
    const now = Date.now();
    const prev = inst.lastCpu;
    const cpu = prev ? ((totals.cpu - prev.value) / 1e4 / ((now - prev.at) * totals.cores)) * 100 : 0;
    inst.lastCpu = { value: totals.cpu, at: now };
    inst.stats = {
      cpu: Math.max(0, Math.min(100, cpu)),
      memory: totals.memory,
      uptime: inst.state.startedAt ? now - inst.state.startedAt : 0,
      players: inst.players.length,
    };
    broadcast('server:stats', id, inst.stats);
  } catch {
  } finally {
    inst.sampling = false;
  }
}

setInterval(() => {
  for (const [id, inst] of instances) if (inst.runner) sample(id, inst);
}, 2000);

setInterval(() => {
  for (const [id, inst] of instances) if (inst.runner) pollPlayers(id, inst);
}, 5000);
