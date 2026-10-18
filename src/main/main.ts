import path from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import type { AppSettings, ArtifactChannel, DbConfig, HostConfig, HostOs, InstallOptions, Profile } from '../shared/types';
import * as artifacts from './artifacts';
import { broadcast, events, toast } from './bus';
import { dropHost, hostFor } from './connections';
import * as files from './files';
import { detectOs } from './hosts';
import { install, testDatabase } from './installer';
import * as resources from './resources';
import * as server from './server';
import { stopShell } from './stats';
import * as store from './store';
import { applyUpdate, checkUpdate } from './updater';
import { validate } from './validate';

app.setPath('userData', path.join(process.env.LOCALAPPDATA ?? app.getPath('appData'), '0x-5mServerControl'));

let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

function requireStopped(id: string) {
  if (server.isRunning(id)) throw new Error('Stop the server first');
}

function applyLoginItem(settings: AppSettings) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath });
}

const handlers: Record<string, (...args: any[]) => unknown> = {
  'settings:get': () => store.getSettings(),
  'settings:set': (patch: Partial<AppSettings>) => {
    const settings = store.setSettings(patch);
    applyLoginItem(settings);
    return settings;
  },
  'profiles:list': () => store.getProfiles().map(store.publicProfile),
  'profiles:update': (id: string, patch: Partial<Profile>) => {
    if ('host' in patch || 'artifactsPath' in patch || 'serverDataPath' in patch) requireStopped(id);
    const profile = store.updateProfile(id, patch);
    if ('host' in patch) {
      server.detachRemote(id);
      dropHost(id);
      if (profile.host) server.attachRemote(id).catch(() => {});
    }
    return store.publicProfile(profile);
  },
  'profiles:remove': (id: string) => {
    requireStopped(id);
    dropHost(id);
    store.removeProfile(id);
  },
  'host:test': (config: { address: string; port: number; username: string; password: string }, profileId?: string) =>
    detectOs(config, config.password || (profileId ? store.decryptSecret(store.getProfile(profileId).host?.password ?? '') : '')),
  'host:rdp': (id: string) => {
    const host = store.getProfile(id).host;
    if (!host || host.os !== 'windows') throw new Error('Remote Desktop is only available for Windows hosts');
    spawn('mstsc.exe', [`/v:${host.address}`], { detached: true, stdio: 'ignore' }).unref();
  },
  'server:states': () => server.getStates(),
  'server:start': (id: string) => server.start(id),
  'server:stop': (id: string) => server.stop(id),
  'server:restart': (id: string) => server.restart(id),
  'server:command': (id: string, command: string) => server.sendCommand(id, command),
  'server:console': (id: string) => server.getConsole(id),
  'server:stats': (id: string) => server.getStats(id),
  'server:players': (id: string) => server.getPlayers(id),
  'server:validate': (id: string) => validate(store.getProfile(id)),
  'resources:list': (id: string) => resources.listResources(id),
  'resources:ensure-get': (id: string) => resources.getEnsureOrder(id),
  'resources:ensure-set': (id: string, order: string[]) => resources.saveEnsureOrder(id, order),
  'files:list': files.list,
  'files:read': files.read,
  'files:write': files.write,
  'files:create': files.create,
  'files:rename': files.rename,
  'files:trash': files.trash,
  'files:import': files.importPaths,
  'files:extract': files.extract,
  'files:pack': files.pack,
  'files:reveal': files.reveal,
  'artifacts:versions': (os?: HostOs) => artifacts.getVersions(os),
  'artifacts:has-previous': async (id: string) => {
    const profile = store.getProfile(id);
    return artifacts.hasPrevious(await hostFor(profile), profile.artifactsPath);
  },
  'artifacts:update': async (id: string, channel: ArtifactChannel, build?: string) => {
    requireStopped(id);
    const profile = store.getProfile(id);
    const installed = await artifacts.installArtifacts(await hostFor(profile), channel, build, profile.artifactsPath, (text) => broadcast('artifacts:log', text));
    return store.publicProfile(store.updateProfile(id, { artifactBuild: installed, previousArtifactBuild: profile.artifactBuild }));
  },
  'artifacts:rollback': async (id: string) => {
    requireStopped(id);
    const profile = store.getProfile(id);
    await artifacts.rollback(await hostFor(profile), profile.artifactsPath);
    return store.publicProfile(store.updateProfile(id, { artifactBuild: profile.previousArtifactBuild, previousArtifactBuild: profile.artifactBuild }));
  },
  'install:run': async (opts: InstallOptions) => store.publicProfile(await install(opts, (text) => broadcast('install:log', text))),
  'install:test-db': (db: DbConfig, host?: HostConfig) => testDatabase(db, host),
  'dialog:folder': async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? undefined : result.filePaths[0];
  },
  'shell:open': (url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  },
  'update:check': () => checkUpdate(),
  'update:apply': async (url: string) => {
    await applyUpdate(url);
    await server.stopLocal();
    quitting = true;
    app.quit();
  },
  'app:close': async (choice: 'stop' | 'tray') => {
    if (choice === 'tray') return win?.hide();
    await server.stopLocal();
    quitting = true;
    app.quit();
  },
};

for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (_event, ...args) => handler(...args));

function trayIcon(running: boolean) {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const shade = running ? 255 : 120;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const alpha = Math.max(0, Math.min(1, 6.5 - d));
      buffer.set([shade, shade, shade, Math.round(alpha * 255)], (y * size + x) * 4);
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function updateTray() {
  if (!tray) return;
  const profiles = store.getProfiles();
  const running = profiles.filter((p) => server.isRunning(p.id));
  tray.setImage(trayIcon(running.length > 0));
  tray.setToolTip(`0x-5mServerControl - ${running.length} of ${profiles.length} running`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...profiles.map((p) => ({ label: `${p.name} - ${server.isRunning(p.id) ? 'Running' : 'Stopped'}`, enabled: false })),
      { type: 'separator' as const },
      { label: 'Show', click: showWindow },
      {
        label: 'Quit',
        click: () => {
          showWindow();
          win?.close();
        },
      },
    ]),
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#09090b',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e4e4e7', height: 40 },
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), sandbox: true, contextIsolation: true },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, '../../src/ui/index.html'));
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('close', (event) => {
    if (quitting) return;
    if (server.localRunning()) {
      event.preventDefault();
      showWindow();
      win?.webContents.send('app:close-request');
    } else {
      quitting = true;
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    createWindow();
    tray = new Tray(trayIcon(false));
    tray.on('click', showWindow);
    updateTray();
    events.on('server:state', updateTray);
    win!.webContents.once('did-finish-load', async () => {
      const profiles = store.getProfiles();
      await Promise.all(profiles.filter((p) => p.host).map((p) => server.attachRemote(p.id).catch((error) => toast('error', `${p.name}: ${error.message}`))));
      for (const profile of profiles.filter((p) => p.autoStart && !server.isRunning(p.id))) server.start(profile.id).catch((error) => toast('error', `${profile.name}: ${error.message}`));
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting || !server.localRunning()) {
      quitting = true;
      stopShell();
      return;
    }
    event.preventDefault();
    showWindow();
    win?.webContents.send('app:close-request');
  });
}

