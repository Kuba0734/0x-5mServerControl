export type ServerMode = 'direct' | 'txadmin';

export type HostOs = 'windows' | 'linux';

export interface HostConfig {
  address: string;
  port: number;
  username: string;
  password: string;
  os: HostOs;
  fingerprint?: string;
}

export interface Profile {
  host?: HostConfig;
  id: string;
  name: string;
  artifactsPath: string;
  serverDataPath: string;
  port: number;
  mode: ServerMode;
  txAdminPort: number;
  autoStart: boolean;
  autoRestart: boolean;
  artifactBuild?: string;
  previousArtifactBuild?: string;
}

export interface AppSettings {
  animations: boolean;
  launchAtLogin: boolean;
  lastProfileId?: string;
}

export type ServerStatus = 'stopped' | 'running' | 'stopping';

export interface ServerState {
  profileId: string;
  status: ServerStatus;
  pid?: number;
  startedAt?: number;
}

export interface ConsoleLine {
  n: number;
  t: number;
  text: string;
  err?: boolean;
}

export interface Stats {
  cpu: number;
  memory: number;
  uptime: number;
  players: number;
}

export interface Player {
  id: number;
  name: string;
  ping: number;
  identifiers: string[];
}

export interface ResourceInfo {
  name: string;
  category: string;
  started: boolean;
}

export interface FileEntry {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export type ArtifactChannel = 'recommended' | 'latest' | 'build';

export interface ArtifactVersions {
  recommended: string;
  latest: string;
  builds: string[];
}

export type BaseKind = 'existing' | 'vanilla' | 'esx' | 'qbcore' | 'qbox';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface InstallOptions {
  host?: HostConfig;
  name: string;
  mode: ServerMode;
  artifacts: { kind: 'download'; channel: ArtifactChannel; build?: string; path: string } | { kind: 'existing'; path: string };
  base: BaseKind;
  serverDataPath: string;
  hostname: string;
  licenseKey: string;
  maxClients: number;
  port: number;
  db?: DbConfig;
}

export interface ValidationIssue {
  ok: boolean;
  label: string;
  detail?: string;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  url?: string;
}
