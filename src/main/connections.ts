import type { Profile } from '../shared/types';
import { connect, localHost, type Host, type RemoteHost } from './hosts';
import { decryptSecret, setFingerprint } from './store';

const pool = new Map<string, Promise<RemoteHost>>();

export async function remoteFor(profile: Profile): Promise<RemoteHost> {
  const config = profile.host;
  if (!config) throw new Error('This profile is not a remote server');
  const existing = pool.get(profile.id);
  if (existing) {
    const host = await existing.catch(() => undefined);
    if (host && !host.closed) return host;
    pool.delete(profile.id);
  }
  const pending = connect(config, decryptSecret(config.password), (fingerprint) => setFingerprint(profile.id, fingerprint));
  pool.set(profile.id, pending);
  pending.catch(() => pool.delete(profile.id));
  return pending;
}

export async function hostFor(profile: Profile): Promise<Host> {
  return profile.host ? remoteFor(profile) : localHost;
}

export function dropHost(id: string) {
  pool.get(id)?.then((host) => host.end(), () => {});
  pool.delete(id);
}
