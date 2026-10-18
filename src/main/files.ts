import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import type { FileEntry } from '../shared/types';
import { hostFor } from './connections';
import { inside, isRemote, psq, sh, type Host, type RemoteHost } from './hosts';
import { getProfile } from './store';
import { unzip, zipFolder } from './net';

const MAX_EDIT_SIZE = 2 * 1024 * 1024;

async function resolve(profileId: string, rel: string) {
  const profile = getProfile(profileId);
  const host = await hostFor(profile);
  return { host, root: host.path.normalize(profile.serverDataPath), full: inside(host, profile.serverDataPath, rel) };
}

function checkName(name: string) {
  if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') throw new Error('Invalid name');
  return name;
}

async function freeName(host: Host, dir: string, name: string) {
  const ext = host.path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; await host.stat(host.path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

export async function list(profileId: string, rel: string): Promise<FileEntry[]> {
  const { host, full } = await resolve(profileId, rel);
  return (await host.list(full)).filter((e) => e.name !== '.' && e.name !== '..').sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export async function read(profileId: string, rel: string) {
  const { host, full } = await resolve(profileId, rel);
  const stat = await host.stat(full);
  if (!stat) throw new Error('File not found');
  if (stat.size > MAX_EDIT_SIZE) throw new Error('File is too large to edit');
  return host.readText(full);
}

export async function write(profileId: string, rel: string, content: string) {
  const { host, full } = await resolve(profileId, rel);
  await host.writeText(full, content);
}

export async function create(profileId: string, rel: string, name: string, dir: boolean) {
  const { host, full } = await resolve(profileId, rel);
  const target = host.path.join(full, checkName(name));
  if (await host.stat(target)) throw new Error('A file with this name already exists');
  if (dir) await host.mkdirp(target);
  else await host.writeText(target, '');
}

export async function rename(profileId: string, rel: string, name: string) {
  const { host, full } = await resolve(profileId, rel);
  const target = host.path.join(host.path.dirname(full), checkName(name));
  if (await host.stat(target)) throw new Error('A file with this name already exists');
  await host.rename(full, target);
}

export function trashDir(host: RemoteHost, profileId: string) {
  return host.path.join(host.home, '.fxsc', profileId, 'trash');
}

export async function trash(profileId: string, rel: string) {
  const { host, root, full } = await resolve(profileId, rel);
  if (full === root) throw new Error('Cannot delete the server-data folder');
  if (!isRemote(host)) return shell.trashItem(full);
  const dir = host.path.join(trashDir(host, profileId), String(Date.now()));
  await host.mkdirp(dir);
  await host.rename(full, host.path.join(dir, host.path.basename(full)));
}

async function uploadTree(host: RemoteHost, local: string, remote: string) {
  if (fs.statSync(local).isDirectory()) {
    await host.mkdirp(remote);
    for (const name of fs.readdirSync(local)) await uploadTree(host, path.join(local, name), host.path.join(remote, name));
  } else {
    await host.upload(local, remote);
  }
}

export async function importPaths(profileId: string, rel: string, sources: string[]) {
  const { host, full } = await resolve(profileId, rel);
  for (const source of sources) {
    const target = host.path.join(full, await freeName(host, full, path.basename(source)));
    if (isRemote(host)) await uploadTree(host, source, target);
    else fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
  }
}

export async function extract(profileId: string, rel: string) {
  const { host, full } = await resolve(profileId, rel);
  const dir = host.path.dirname(full);
  const target = host.path.join(dir, await freeName(host, dir, host.path.basename(full, host.path.extname(full))));
  if (!isRemote(host)) return unzip(full, target);
  await host.mkdirp(target);
  if (host.os === 'windows') await host.run(`tar.exe -xf ${psq(host.native(full))} -C ${psq(host.native(target))}`);
  else await host.run(`unzip -oq ${sh(full)} -d ${sh(target)}`);
}

export async function pack(profileId: string, rel: string) {
  const { host, full } = await resolve(profileId, rel);
  const dir = host.path.dirname(full);
  const target = host.path.join(dir, await freeName(host, dir, host.path.basename(full) + '.zip'));
  if (!isRemote(host)) return zipFolder(full, target);
  if (host.os === 'windows') await host.run(`tar.exe -a -cf ${psq(host.native(target))} -C ${psq(host.native(dir))} ${psq(host.path.basename(full))}`);
  else await host.run(`cd ${sh(dir)} && zip -rq ${sh(target)} ${sh(host.path.basename(full))}`);
}

export async function reveal(profileId: string, rel: string) {
  const { host, full } = await resolve(profileId, rel);
  if (host.remote) throw new Error('Not available for remote servers');
  if ((await host.stat(full))?.dir) shell.openPath(full);
  else shell.showItemInFolder(full);
}
