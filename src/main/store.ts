import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, safeStorage } from 'electron';
import type { AppSettings, HostConfig, Profile } from '../shared/types';

export function encryptSecret(value: string) {
  return safeStorage.encryptString(value).toString('base64');
}

export function decryptSecret(value: string) {
  return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '';
}

export function publicProfile(profile: Profile): Profile {
  return profile.host ? { ...profile, host: { ...profile.host, password: '' } } : profile;
}

function sealHost(next: HostConfig | undefined, previous?: HostConfig) {
  if (!next) return undefined;
  const sameServer = previous && previous.address === next.address && previous.port === next.port;
  return {
    ...next,
    password: next.password ? encryptSecret(next.password) : (previous?.password ?? ''),
    fingerprint: sameServer ? (previous.fingerprint ?? next.fingerprint) : next.fingerprint,
  };
}

interface Data {
  settings: AppSettings;
  profiles: Profile[];
}

const defaults: Data = { settings: { animations: true, launchAtLogin: false }, profiles: [] };

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

let data: Data | undefined;

function load(): Data {
  if (data) return data;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    data = { settings: { ...defaults.settings, ...raw.settings }, profiles: raw.profiles ?? [] };
  } catch {
    data = structuredClone(defaults);
  }
  return data;
}

function save() {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(target + '.tmp', target);
}

export function getSettings() {
  return load().settings;
}

export function setSettings(patch: Partial<AppSettings>) {
  Object.assign(load().settings, patch);
  save();
  return load().settings;
}

export function getProfiles() {
  return load().profiles;
}

export function getProfile(id: string) {
  const profile = load().profiles.find((p) => p.id === id);
  if (!profile) throw new Error('Profile not found');
  return profile;
}

export function addProfile(profile: Omit<Profile, 'id'>) {
  const created = { ...profile, host: sealHost(profile.host), id: crypto.randomUUID() };
  load().profiles.push(created);
  save();
  return created;
}

export function updateProfile(id: string, patch: Partial<Profile>) {
  const profile = getProfile(id);
  const host = 'host' in patch ? sealHost(patch.host, profile.host) : profile.host;
  Object.assign(profile, patch, { id, host });
  save();
  return getProfile(id);
}

export function setFingerprint(id: string, fingerprint: string) {
  const host = getProfile(id).host;
  if (!host) return;
  host.fingerprint = fingerprint;
  save();
}

export function removeProfile(id: string) {
  const d = load();
  d.profiles = d.profiles.filter((p) => p.id !== id);
  save();
}
