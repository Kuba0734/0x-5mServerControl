import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import type { FileEntry, HostOs } from '../shared/types';

export interface Stat {
  dir: boolean;
  size: number;
  mtime: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Host {
  remote: boolean;
  os: HostOs;
  path: typeof path.posix;
  stat(p: string): Promise<Stat | undefined>;
  list(p: string): Promise<FileEntry[]>;
  readText(p: string): Promise<string>;
  readFrom(p: string, offset: number, max: number): Promise<Buffer>;
  writeText(p: string, text: string): Promise<void>;
  mkdirp(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export function inside(host: Host, root: string, rel: string) {
  const p = host.path;
  const base = p.normalize(root).replace(/[\\/]+$/, '');
  const full = p.normalize(p.join(base, rel || '.')).replace(/[\\/]+$/, '');
  if (full !== base && !full.startsWith(base + p.sep)) throw new Error('Path is outside of the allowed folder');
  return full;
}

export const localHost: Host = {
  remote: false,
  os: 'windows',
  path: path.win32,
  async stat(p) {
    try {
      const s = await fs.stat(p);
      return { dir: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
    } catch {
      return undefined;
    }
  },
  async list(p) {
    const entries = await fs.readdir(p);
    const out: FileEntry[] = [];
    for (const name of entries) {
      const s = await localHost.stat(path.join(p, name));
      if (s) out.push({ name, ...s });
    }
    return out;
  },
  readText: (p) => fs.readFile(p, 'utf8'),
  async readFrom(p, offset, max) {
    const handle = await fs.open(p, 'r');
    try {
      const buffer = Buffer.alloc(max);
      const { bytesRead } = await handle.read(buffer, 0, max, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  writeText: (p, text) => fs.writeFile(p, text),
  mkdirp: async (p) => void (await fs.mkdir(p, { recursive: true })),
  rename: (from, to) => fs.rename(from, to),
};

export function sh(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function psq(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function promisify<T>(fn: (cb: (err: Error | null | undefined, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));
}

export class RemoteHost implements Host {
  remote = true;
  path = path.posix;
  home = '';
  cores = 1;
  private sftpChannel?: SFTPWrapper;

  constructor(
    private client: Client,
    public os: HostOs,
  ) {}

  get closed() {
    return !this.sftpChannel;
  }

  async init() {
    this.sftpChannel = await promisify<SFTPWrapper>((cb) => this.client.sftp(cb));
    this.home = this.fromSftp(await promisify<string>((cb) => this.sftpChannel!.realpath('.', cb)));
    const cores = this.os === 'linux' ? await this.exec('nproc') : await this.ps('$env:NUMBER_OF_PROCESSORS');
    this.cores = Number(cores.stdout.trim()) || 1;
    this.client.on('close', () => (this.sftpChannel = undefined));
  }

  private get sftp() {
    if (!this.sftpChannel) throw new Error('SSH connection was closed');
    return this.sftpChannel;
  }

  private fromSftp(p: string) {
    return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p;
  }

  native(p: string) {
    return this.os === 'windows' ? p.replace(/\//g, '\\') : p;
  }

  exec(command: string, input?: string) {
    return new Promise<ExecResult>((resolve, reject) => {
      this.client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
        stream.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        stream.on('close', (code: number | null) => resolve({ stdout, stderr, code: code ?? 0 }));
        if (input !== undefined) stream.end(input);
      });
    });
  }

  ps(script: string) {
    return this.exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`);
  }

  async run(command: string) {
    const result = this.os === 'windows' ? await this.ps(`$ErrorActionPreference='Stop'; ${command}`) : await this.exec(command);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ') || `Command failed (${result.code})`);
    return result.stdout;
  }

  async stat(p: string) {
    try {
      const s = await promisify<any>((cb) => this.sftp.stat(p, cb));
      return { dir: s.isDirectory(), size: s.size, mtime: s.mtime * 1000 };
    } catch {
      return undefined;
    }
  }

  async list(p: string) {
    const items = await promisify<any[]>((cb) => this.sftp.readdir(p, cb));
    return items.map((item) => ({ name: item.filename, dir: item.attrs.isDirectory(), size: item.attrs.size, mtime: item.attrs.mtime * 1000 }));
  }

  async readText(p: string) {
    const data = await promisify<Buffer>((cb) => this.sftp.readFile(p, cb as never));
    return data.toString('utf8');
  }

  async readFrom(p: string, offset: number, max: number) {
    const handle = await promisify<Buffer>((cb) => this.sftp.open(p, 'r', cb));
    try {
      const buffer = Buffer.alloc(max);
      const read = await new Promise<number>((resolve, reject) => this.sftp.read(handle, buffer, 0, max, offset, (err, bytes) => (err ? reject(err) : resolve(bytes))));
      return buffer.subarray(0, read);
    } finally {
      this.sftp.close(handle, () => {});
    }
  }

  writeText(p: string, text: string) {
    return promisify<void>((cb) => this.sftp.writeFile(p, text, cb as never));
  }

  async mkdirp(p: string) {
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      if (!sub || /^[A-Za-z]:$/.test(sub) || (await this.stat(sub))) continue;
      await promisify<void>((cb) => this.sftp.mkdir(sub, cb as never));
    }
  }

  rename(from: string, to: string) {
    return promisify<void>((cb) => this.sftp.rename(from, to, cb as never));
  }

  upload(local: string, remote: string) {
    return promisify<void>((cb) => this.sftp.fastPut(local, remote, cb as never));
  }

  async remove(p: string) {
    if (this.os === 'windows') await this.run(`Remove-Item -LiteralPath ${psq(this.native(p))} -Recurse -Force -ErrorAction SilentlyContinue; exit 0`);
    else await this.run(`rm -rf -- ${sh(p)}`);
  }

  forward(host: string, port: number) {
    return promisify<ClientChannel>((cb) => this.client.forwardOut('127.0.0.1', 0, host, port, cb as never));
  }

  end() {
    this.client.end();
  }
}

export async function connect(config: { address: string; port: number; username: string; os: HostOs; fingerprint?: string }, password: string, onFingerprint?: (fingerprint: string) => void) {
  const client = new Client();
  let mismatch = false;
  await new Promise<void>((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', (err) => reject(mismatch ? new Error('The host key of this server changed. Connection refused.') : err));
    client.connect({
      host: config.address,
      port: config.port,
      username: config.username,
      password,
      readyTimeout: 15000,
      keepaliveInterval: 15000,
      hostHash: 'sha256',
      hostVerifier: (hash: string) => {
        if (!config.fingerprint) {
          onFingerprint?.(hash);
          return true;
        }
        mismatch = hash !== config.fingerprint;
        return !mismatch;
      },
    } as never);
  });
  client.on('error', () => {});
  const host = new RemoteHost(client, config.os);
  await host.init();
  return host;
}

export async function detectOs(config: { address: string; port: number; username: string }, password: string): Promise<{ os: HostOs; fingerprint: string }> {
  let fingerprint = '';
  const host = await connect({ ...config, os: 'linux' }, password, (f) => (fingerprint = f));
  const result = await host.exec('uname -s');
  host.end();
  return { os: /linux/i.test(result.stdout) ? 'linux' : 'windows', fingerprint };
}

export function isRemote(host: Host): host is RemoteHost {
  return host.remote;
}
