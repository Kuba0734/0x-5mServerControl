import net from 'node:net';
import dgram from 'node:dgram';
import type { Profile, ValidationIssue } from '../shared/types';
import { readLicenseKey, readPort } from './cfg';
import { hostFor } from './connections';
import { isRemote, type Host } from './hosts';

function tcpFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

function udpFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', () => resolve(false));
    socket.bind(port, '0.0.0.0', () => socket.close(() => resolve(true)));
  });
}

export async function portFree(host: Host, port: number) {
  if (!isRemote(host)) return (await tcpFree(port)) && (await udpFree(port));
  if (host.os === 'windows') {
    const result = await host.ps(`Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue; Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue`);
    return !result.stdout.trim();
  }
  const result = await host.exec(`ss -Hltun 2>/dev/null | awk '{print $5}' | grep -E ':${port}$'`);
  return !result.stdout.trim();
}

export function serverBinary(host: Host, artifactsPath: string) {
  return host.path.join(artifactsPath, host.os === 'windows' ? 'FXServer.exe' : 'run.sh');
}

export async function validate(profile: Profile): Promise<ValidationIssue[]> {
  let host: Host;
  try {
    host = await hostFor(profile);
  } catch (error) {
    return [{ ok: false, label: 'SSH connection', detail: (error as Error).message }];
  }
  const exists = async (p: string) => !!p && !!(await host.stat(p));
  const exe = serverBinary(host, profile.artifactsPath);
  const issues: ValidationIssue[] = [];
  if (profile.host) issues.push({ ok: true, label: 'SSH connection', detail: `${profile.host.username}@${profile.host.address}` });
  if (isRemote(host) && host.os === 'linux') issues.push({ ok: !!(await host.exec('command -v screen')).stdout.trim(), label: 'screen is installed' });
  issues.push(
    { ok: await exists(profile.artifactsPath), label: 'Artifacts folder exists', detail: profile.artifactsPath },
    { ok: await exists(exe), label: `${host.path.basename(exe)} found`, detail: exe },
  );
  if (profile.mode === 'txadmin') {
    issues.push({ ok: await portFree(host, profile.txAdminPort), label: `txAdmin port ${profile.txAdminPort} is free` });
    return issues;
  }
  const cfgPath = host.path.join(profile.serverDataPath, 'server.cfg');
  const cfg = await host.readText(cfgPath).catch(() => '');
  const port = readPort(cfg) ?? profile.port;
  issues.push(
    { ok: await exists(profile.serverDataPath), label: 'server-data folder exists', detail: profile.serverDataPath },
    { ok: !!cfg, label: 'server.cfg found', detail: cfgPath },
    { ok: !!readLicenseKey(cfg), label: 'sv_licenseKey is set' },
    { ok: await portFree(host, port), label: `Port ${port} is free` },
  );
  return issues;
}
