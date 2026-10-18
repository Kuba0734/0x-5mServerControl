import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArtifactChannel, ArtifactVersions, HostOs } from '../shared/types';
import { isRemote, psq, sh, type Host, type RemoteHost } from './hosts';
import { download, fetchText, unzip } from './net';

const SOURCES: Record<HostOs, { listing: string; versions: string; file: string; folder: string }> = {
  windows: {
    listing: 'https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/',
    versions: 'https://changelogs-live.fivem.net/api/changelog/versions/win32/server',
    file: 'server.zip',
    folder: 'build_server_windows',
  },
  linux: {
    listing: 'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/',
    versions: 'https://changelogs-live.fivem.net/api/changelog/versions/linux/server',
    file: 'fx.tar.xz',
    folder: 'build_proot_linux',
  },
};

async function listing(target: HostOs) {
  const source = SOURCES[target];
  const html = await fetchText(source.listing);
  const builds = new Map<string, string>();
  const pattern = new RegExp(`${source.folder}\\/master\\/((\\d+)-[0-9a-f]{40})\\/`, 'g');
  for (const match of html.matchAll(pattern)) builds.set(match[2], `${source.listing}${match[1]}/${source.file}`);
  return builds;
}

export async function getVersions(target: HostOs = 'windows'): Promise<ArtifactVersions> {
  const [info, builds] = await Promise.all([fetchText(SOURCES[target].versions).then(JSON.parse), listing(target)]);
  return {
    recommended: info.recommended,
    latest: info.latest,
    builds: [...builds.keys()].sort((a, b) => Number(b) - Number(a)).slice(0, 200),
  };
}

async function resolve(target: HostOs, channel: ArtifactChannel, build?: string) {
  if (channel !== 'build') {
    const info = JSON.parse(await fetchText(SOURCES[target].versions));
    return { build: String(info[channel]), url: String(info[`${channel}_download`]) };
  }
  const url = (await listing(target)).get(String(build));
  if (!url) throw new Error(`Build ${build} not found`);
  return { build: String(build), url };
}

async function fetchLocal(url: string, dest: string, log: (text: string) => void) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxs-'));
  try {
    const zip = path.join(tmp, 'server.zip');
    let lastPercent = -1;
    await download(url, zip, (received, total) => {
      const percent = total ? Math.floor((received / total) * 10) * 10 : -1;
      if (percent !== lastPercent && percent >= 0) log(`Downloading artifacts ${(lastPercent = percent)}%`);
    });
    log('Extracting artifacts');
    await unzip(zip, dest);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function fetchRemote(host: RemoteHost, url: string, dest: string, log: (text: string) => void) {
  const tmp = host.path.join(host.home, '.fxsc', `download-${Date.now()}`);
  const file = host.path.join(tmp, SOURCES[host.os].file);
  await host.mkdirp(tmp);
  await host.mkdirp(dest);
  try {
    log('Downloading artifacts on the server');
    if (host.os === 'windows') {
      await host.run(`curl.exe -fsSL -o ${psq(host.native(file))} ${psq(url)}; if ($LASTEXITCODE) { throw 'Download failed' }`);
      log('Extracting artifacts');
      await host.run(`tar.exe -xf ${psq(host.native(file))} -C ${psq(host.native(dest))}; if ($LASTEXITCODE) { throw 'Extract failed' }`);
    } else {
      await host.run(`(curl -fsSL -o ${sh(file)} ${sh(url)} || wget -qO ${sh(file)} ${sh(url)})`);
      log('Extracting artifacts');
      await host.run(`tar -xJf ${sh(file)} -C ${sh(dest)}`);
    }
  } finally {
    await host.remove(tmp);
  }
}

async function removeDir(host: Host, p: string) {
  if (isRemote(host)) await host.remove(p);
  else fs.rmSync(p, { recursive: true, force: true });
}

export async function installArtifacts(host: Host, channel: ArtifactChannel, build: string | undefined, target: string, log: (text: string) => void) {
  const resolved = await resolve(host.os, channel, build);
  const staging = target + '.new';
  const binary = host.path.join(staging, host.os === 'windows' ? 'FXServer.exe' : 'run.sh');
  log(`Installing artifacts build ${resolved.build}`);
  await removeDir(host, staging);
  try {
    if (isRemote(host)) await fetchRemote(host, resolved.url, staging, log);
    else await fetchLocal(resolved.url, staging, log);
    if (!(await host.stat(binary))) throw new Error(`${host.path.basename(binary)} missing in download`);
  } catch (error) {
    await removeDir(host, staging);
    throw error;
  }
  const previous = target + '.previous';
  if (await host.stat(target)) {
    await removeDir(host, previous);
    await host.rename(target, previous);
  }
  await host.rename(staging, target);
  log(`Artifacts build ${resolved.build} installed`);
  return resolved.build;
}

export async function hasPrevious(host: Host, target: string) {
  return !!(await host.stat(target + '.previous'));
}

export async function rollback(host: Host, target: string) {
  const previous = target + '.previous';
  if (!(await host.stat(previous))) throw new Error('No previous version to roll back to');
  const swap = target + '.swap';
  await host.rename(target, swap);
  await host.rename(previous, target);
  await host.rename(swap, previous);
}
