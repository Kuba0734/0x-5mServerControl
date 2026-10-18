import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import mysql from 'mysql2/promise';
import { execFile } from 'node:child_process';
import type { BaseKind, DbConfig, HostConfig, InstallOptions } from '../shared/types';
import { installArtifacts } from './artifacts';
import { fillPlaceholders } from './cfg';
import { connect, localHost, psq, sh, type Host, type RemoteHost } from './hosts';
import { download, fetchText, unzip } from './net';
import { addProfile } from './store';
import { serverBinary } from './validate';

const RECIPES: Record<Exclude<BaseKind, 'existing'>, string> = {
  vanilla: 'https://raw.githubusercontent.com/citizenfx/txAdmin-recipes/refs/heads/main/default-fivem/recipe.yaml',
  esx: 'https://raw.githubusercontent.com/esx-framework/ESX-recipes/legacy/recipe.yaml',
  qbcore: 'https://raw.githubusercontent.com/qbcore-framework/txAdminRecipe/main/qbcore.yaml',
  qbox: 'https://raw.githubusercontent.com/Qbox-project/txAdminRecipe/refs/heads/main/qbox.yaml',
};

type Task = Record<string, string | number | boolean | undefined> & { action: string };

interface Recipe {
  name?: string;
  author?: string;
  description?: string;
  $onesync?: string;
  tasks: Task[];
}

export function connectionString(db: DbConfig) {
  return `mysql://${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@${db.host}:${db.port}/${db.database}?charset=utf8mb4`;
}

type DbConnect = (db: DbConfig) => Promise<mysql.Connection>;

function dbConnector(remote?: RemoteHost): DbConnect {
  return async (db) => {
    const base = { user: db.user, password: db.password, multipleStatements: true, charset: 'utf8mb4', connectTimeout: 10000 };
    if (!remote) return mysql.createConnection({ ...base, host: db.host, port: db.port });
    return mysql.createConnection({ ...base, stream: (await remote.forward(db.host, db.port)) as never });
  };
}

async function withHost<T>(config: HostConfig | undefined, fn: (host: Host, remote?: RemoteHost) => Promise<T>) {
  if (!config) return fn(localHost);
  const remote = await connect(config, config.password, (fingerprint) => (config.fingerprint = fingerprint));
  try {
    return await fn(remote, remote);
  } finally {
    remote.end();
  }
}

export async function testDatabase(db: DbConfig, hostConfig?: HostConfig) {
  await withHost(hostConfig, async (_host, remote) => {
    const conn = await dbConnector(remote)(db);
    await conn.end();
  });
}

function inside(root: string, rel: unknown) {
  if (typeof rel !== 'string' || !rel) throw new Error('Recipe task is missing a path');
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Recipe path escapes the server folder: ${rel}`);
  return full;
}

function replaceDir(src: string, dest: string, move: boolean) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (move) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch {}
  }
  fs.cpSync(src, dest, { recursive: true });
  if (move) fs.rmSync(src, { recursive: true, force: true });
}

async function downloadGithub(task: Task, root: string, tmp: string) {
  const match = String(task.src).match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error(`Invalid GitHub source: ${task.src}`);
  const dest = inside(root, task.dest);
  const zip = path.join(tmp, `gh-${Date.now()}.zip`);
  const extracted = zip.replace(/\.zip$/, '');
  await download(`https://github.com/${match[1]}/${match[2]}/archive/${task.ref ?? 'HEAD'}.zip`, zip);
  await unzip(zip, extracted);
  const [top] = fs.readdirSync(extracted);
  const source = task.subpath ? inside(path.join(extracted, top), task.subpath) : path.join(extracted, top);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  fs.rmSync(extracted, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
}

async function runRecipe(recipe: Recipe, root: string, db: DbConfig | undefined, dbConnect: DbConnect, log: (text: string) => void) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-'));
  let conn: mysql.Connection | undefined;
  try {
    for (const [index, task] of recipe.tasks.entries()) {
      log(`[${index + 1}/${recipe.tasks.length}] ${task.action} ${task.src ?? task.url ?? task.path ?? task.file ?? ''}`);
      switch (task.action) {
        case 'download_github':
          await downloadGithub(task, root, tmp);
          break;
        case 'download_file':
          await download(String(task.url), inside(root, task.path));
          break;
        case 'unzip':
          await unzip(inside(root, task.src), inside(root, task.dest));
          break;
        case 'move_path':
          replaceDir(inside(root, task.src), inside(root, task.dest), true);
          break;
        case 'copy_path':
          fs.cpSync(inside(root, task.src), inside(root, task.dest), { recursive: true, force: task.overwrite !== false });
          break;
        case 'remove_path':
          fs.rmSync(inside(root, task.path), { recursive: true, force: true });
          break;
        case 'ensure_dir':
          fs.mkdirSync(inside(root, task.path), { recursive: true });
          break;
        case 'write_file': {
          const file = inside(root, task.file);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs[task.append ? 'appendFileSync' : 'writeFileSync'](file, String(task.data ?? ''));
          break;
        }
        case 'replace_string': {
          const file = inside(root, task.file);
          fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(String(task.search)).join(String(task.replace ?? '')));
          break;
        }
        case 'connect_database': {
          if (!db) {
            log('Skipped, no database configured');
            break;
          }
          conn = await dbConnect(db);
          await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
          await conn.changeUser({ database: db.database });
          break;
        }
        case 'query_database': {
          if (!db) {
            log('Skipped, no database configured');
            break;
          }
          if (!conn) throw new Error('Database is not connected');
          await conn.query(task.file ? fs.readFileSync(inside(root, task.file), 'utf8') : String(task.query));
          break;
        }
        case 'waste_time':
          await new Promise((resolve) => setTimeout(resolve, Number(task.seconds ?? 1) * 1000));
          break;
        case 'fail':
          throw new Error(String(task.message ?? 'Recipe failed'));
        default:
          throw new Error(`Unsupported recipe action: ${task.action}`);
      }
    }
  } finally {
    await conn?.end().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(path.join(root, 'tmp'), { recursive: true, force: true });
  }
}

function finalizeCfgs(root: string, vars: Record<string, string>, onesync: boolean) {
  for (const name of fs.readdirSync(root).filter((n) => n.endsWith('.cfg'))) {
    const file = path.join(root, name);
    fs.writeFileSync(file, fillPlaceholders(fs.readFileSync(file, 'utf8'), vars));
  }
  const cfg = path.join(root, 'server.cfg');
  if (!fs.existsSync(cfg)) throw new Error('Recipe did not create a server.cfg');
  const text = fs.readFileSync(cfg, 'utf8');
  if (onesync && !/^\s*set\s+onesync\b/im.test(text)) fs.writeFileSync(cfg, `set onesync on\n${text}`);
}

function localTar(args: string[]) {
  return new Promise<void>((resolve, reject) => execFile('tar.exe', args, { windowsHide: true }, (error, _out, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve())));
}

async function uploadTree(host: RemoteHost, localRoot: string, target: string, log: (text: string) => void) {
  const archive = path.join(os.tmpdir(), `fxsc-upload-${Date.now()}.tar`);
  const remoteArchive = host.path.join(host.home, '.fxsc', path.basename(archive));
  try {
    log('Packing server files');
    await localTar(['-cf', archive, '-C', localRoot, '.']);
    log('Uploading server files');
    await host.mkdirp(host.path.dirname(remoteArchive));
    await host.upload(archive, remoteArchive);
    log('Extracting server files on the server');
    await host.mkdirp(target);
    if (host.os === 'windows') await host.run(`tar.exe -xf ${psq(host.native(remoteArchive))} -C ${psq(host.native(target))}; if ($LASTEXITCODE) { throw 'Extract failed' }`);
    else await host.run(`tar -xf ${sh(remoteArchive)} -C ${sh(target)}`);
  } finally {
    fs.rmSync(archive, { force: true });
    await host.remove(remoteArchive).catch(() => {});
  }
}

async function isEmptyOrMissing(host: Host, dir: string) {
  try {
    return (await host.list(dir)).filter((e) => e.name !== '.' && e.name !== '..').length === 0;
  } catch {
    return true;
  }
}

export async function install(opts: InstallOptions, log: (text: string) => void) {
  return withHost(opts.host, async (host, remote) => {
    const root = remote ? host.path.normalize(opts.serverDataPath) : path.resolve(opts.serverDataPath);
    const artifactsPath = remote ? host.path.normalize(opts.artifacts.path) : path.resolve(opts.artifacts.path);
    if (opts.base !== 'existing' && !(await isEmptyOrMissing(host, root))) throw new Error('The server-data folder must be empty');
    if (opts.base === 'existing' && !(await host.stat(host.path.join(root, 'server.cfg')))) throw new Error('No server.cfg found in the selected server-data folder');

    let artifactBuild: string | undefined;
    if (opts.artifacts.kind === 'download') {
      artifactBuild = await installArtifacts(host, opts.artifacts.channel, opts.artifacts.build, artifactsPath, log);
    } else if (!(await host.stat(serverBinary(host, artifactsPath)))) {
      throw new Error(`${host.os === 'windows' ? 'FXServer.exe' : 'run.sh'} not found in the selected artifacts folder`);
    }

    if (opts.base !== 'existing') {
      log(`Loading ${opts.base} recipe`);
      const recipe = yaml.load(await fetchText(RECIPES[opts.base])) as Recipe;
      const buildRoot = remote ? fs.mkdtempSync(path.join(os.tmpdir(), 'fxsc-build-')) : root;
      try {
        fs.mkdirSync(buildRoot, { recursive: true });
        await runRecipe(recipe, buildRoot, opts.db, dbConnector(remote), log);
        finalizeCfgs(
          buildRoot,
          {
            serverName: opts.hostname,
            recipeName: recipe.name ?? opts.base,
            recipeAuthor: recipe.author ?? '',
            recipeDescription: recipe.description ?? '',
            svLicense: opts.licenseKey,
            maxClients: String(opts.maxClients),
            serverEndpoints: `endpoint_add_tcp "0.0.0.0:${opts.port}"\nendpoint_add_udp "0.0.0.0:${opts.port}"`,
            dbConnectionString: opts.db ? connectionString(opts.db) : '',
            addPrincipalsMaster: '',
          },
          String(recipe.$onesync ?? '') === 'on',
        );
        if (remote) await uploadTree(remote, buildRoot, root, log);
      } finally {
        if (remote) fs.rmSync(buildRoot, { recursive: true, force: true });
      }
    }

    log('Creating profile');
    return addProfile({
      host: opts.host,
      name: opts.name,
      artifactsPath,
      serverDataPath: root,
      port: opts.port,
      mode: opts.mode,
      txAdminPort: 40120,
      autoStart: false,
      autoRestart: true,
      artifactBuild,
    });
  });
}
