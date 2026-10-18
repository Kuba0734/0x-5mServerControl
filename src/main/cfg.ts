import { hostFor } from './connections';
import type { Profile } from '../shared/types';

const ensureLine = /^\s*(ensure|start)\s+(\S+)/i;

export function readLicenseKey(text: string) {
  const match = text.match(/^\s*sv_licenseKey\s+"?([^"\s#]*)"?/im);
  const key = match?.[1] ?? '';
  return key && !key.includes('{{') && key.toLowerCase() !== 'changeme' ? key : '';
}

export function readPort(text: string) {
  const match = text.match(/^\s*endpoint_add_tcp\s+"?[^":\s]*:(\d+)"?/im);
  return match ? Number(match[1]) : undefined;
}

export function getEnsureList(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(ensureLine);
    return match ? [match[2]] : [];
  });
}

export function setEnsureOrder(text: string, order: string[]) {
  const lines = text.split(/\r?\n/);
  const byName = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(ensureLine);
    if (match) byName.set(match[2], line);
  }
  if (order.length !== byName.size || order.some((name) => !byName.has(name))) throw new Error('Resource list changed, reload and try again');
  let index = 0;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return lines.map((line) => (ensureLine.test(line) ? byName.get(order[index++])! : line)).join(eol);
}

export function fillPlaceholders(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key) => vars[key] ?? all);
}

export async function readServerCfg(profile: Profile) {
  try {
    const host = await hostFor(profile);
    return await host.readText(host.path.join(profile.serverDataPath, 'server.cfg'));
  } catch {
    return '';
  }
}

export async function effectivePort(profile: Profile) {
  return readPort(await readServerCfg(profile)) ?? profile.port;
}
