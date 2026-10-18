import type { ResourceInfo } from '../shared/types';
import { getEnsureList, readServerCfg, setEnsureOrder } from './cfg';
import { hostFor } from './connections';
import type { Host } from './hosts';
import { getProfile } from './store';
import { startedResources } from './server';

async function scan(host: Host, dir: string, category: string, out: ResourceInfo[], started: Set<string>) {
  let entries;
  try {
    entries = await host.list(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((e) => e.dir && e.name !== '.' && e.name !== '..')
      .map(async (entry) => {
        const full = host.path.join(dir, entry.name);
        if (/^\[.*\]$/.test(entry.name)) return scan(host, full, category ? `${category}/${entry.name}` : entry.name, out, started);
        const files = await host.list(full).catch(() => []);
        if (files.some((f) => f.name === 'fxmanifest.lua' || f.name === '__resource.lua')) out.push({ name: entry.name, category, started: started.has(entry.name) });
      }),
  );
}

export async function listResources(profileId: string) {
  const profile = getProfile(profileId);
  const host = await hostFor(profile);
  const out: ResourceInfo[] = [];
  await scan(host, host.path.join(profile.serverDataPath, 'resources'), '', out, startedResources(profileId));
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export async function getEnsureOrder(profileId: string) {
  return getEnsureList(await readServerCfg(getProfile(profileId)));
}

export async function saveEnsureOrder(profileId: string, order: string[]) {
  const profile = getProfile(profileId);
  const host = await hostFor(profile);
  const text = await host.readText(host.path.join(profile.serverDataPath, 'server.cfg'));
  await host.writeText(host.path.join(profile.serverDataPath, 'server.cfg'), setEnsureOrder(text, order));
}
