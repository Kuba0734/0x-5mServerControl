import type { AppSettings, Profile, ServerState } from '../shared/types.js';
import { api, call, run } from './api.js';
import { button, empty, h, icon, modal, toast } from './dom.js';
import type { Page, PageContext } from './context.js';
import { applySettings } from './motion.js';
import { openWizard } from './wizard.js';
import { consolePage } from './pages/console.js';
import { performancePage } from './pages/performance.js';
import { playersPage } from './pages/players.js';
import { resourcesPage } from './pages/resources.js';
import { filesPage } from './pages/files.js';
import { serverSettingsPage } from './pages/server-settings.js';
import { artifactsPage } from './pages/artifacts.js';
import { settingsPage } from './pages/settings.js';

const PAGES: { key: string; label: string; icon: string; page: Page }[] = [
  { key: 'console', label: 'Console', icon: 'console', page: consolePage },
  { key: 'performance', label: 'Performance', icon: 'chart', page: performancePage },
  { key: 'players', label: 'Players', icon: 'users', page: playersPage },
  { key: 'resources', label: 'Resources', icon: 'box', page: resourcesPage },
  { key: 'files', label: 'Files', icon: 'folder', page: filesPage },
  { key: 'server-settings', label: 'Server settings', icon: 'sliders', page: serverSettingsPage },
  { key: 'artifacts', label: 'Artifacts', icon: 'download', page: artifactsPage },
  { key: 'settings', label: 'Profile & app', icon: 'settings', page: settingsPage },
];

let profiles: Profile[] = [];
const states = new Map<string, ServerState>();
let settings: AppSettings = { animations: true, launchAtLogin: false };
let currentId: string | undefined;
let currentPage = 'console';
let cleanup: (() => void) | void;
let ctx: PageContext | undefined;

const serverList = h('div', { class: 'server-list' });
const nav = h('nav', { class: 'nav' });
const header = h('header', { class: 'header' });
const stage = h('div', { class: 'stage' });
const busy = new Set<string>();

function stateOf(id: string): ServerState {
  return states.get(id) ?? { profileId: id, status: 'stopped' };
}

function current() {
  return profiles.find((p) => p.id === currentId);
}

function statusLabel(state: ServerState) {
  return { stopped: 'Stopped', running: 'Running', stopping: 'Stopping' }[state.status];
}

function renderSidebar() {
  serverList.replaceChildren(
    ...profiles.map((p) =>
      h(
        'button',
        { type: 'button', class: `server-item${p.id === currentId ? ' active' : ''}`, onClick: () => select(p.id) },
        h('span', { class: `dot ${stateOf(p.id).status}` }),
        h('span', { class: 'server-name' }, p.name),
        h('span', { class: 'server-mode' }, [p.host ? 'SSH' : '', p.mode === 'txadmin' ? 'txAdmin' : ''].filter(Boolean).join(' · ')),
      ),
    ),
    h('button', { type: 'button', class: 'server-item add', onClick: newServer }, icon('plus'), h('span', {}, 'New server')),
  );
  nav.replaceChildren(
    ...PAGES.map((p) =>
      h('button', { type: 'button', class: `nav-item${p.key === currentPage ? ' active' : ''}`, disabled: !currentId, onClick: () => navigate(p.key) }, icon(p.icon), h('span', {}, p.label)),
    ),
  );
}

async function control(action: 'start' | 'stop' | 'restart') {
  const id = currentId;
  if (!id || busy.has(id)) return;
  busy.add(id);
  renderHeader();
  if (await run(`server:${action}`, id)) toast('success', `${current()?.name} ${action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarted'}`);
  busy.delete(id);
  renderHeader();
}

function renderHeader() {
  const profile = current();
  if (!profile) return header.replaceChildren();
  const state = stateOf(profile.id);
  const running = state.status !== 'stopped';
  const locked = busy.has(profile.id) || state.status === 'stopping';
  header.replaceChildren(
    h('div', { class: 'header-title' }, h('h1', {}, profile.name), h('span', { class: `pill ${state.status}` }, h('span', { class: `dot ${state.status}` }), statusLabel(state))),
    h('div', { class: 'spacer' }),
    h(
      'div',
      { class: 'actions' },
      profile.host?.os === 'windows' ? button('Remote Desktop', () => run('host:rdp', profile.id), { kind: 'ghost', icon: 'server' }) : null,
      profile.mode === 'txadmin' && running ? button('txAdmin', () => call('shell:open', `http://${profile.host?.address ?? 'localhost'}:${profile.txAdminPort}`), { kind: 'ghost', icon: 'external' }) : null,
      running
        ? [button('Restart', () => control('restart'), { icon: 'restart', disabled: locked }), button('Stop', () => control('stop'), { kind: 'danger', icon: 'stop', disabled: locked })]
        : button('Start', () => control('start'), { kind: 'primary', icon: 'play', disabled: locked }),
    ),
  );
}

function mountPage() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  const old = [...stage.children] as HTMLElement[];
  for (const el of old) {
    el.classList.add('page-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }
  const container = h('div', { class: 'page page-entering' });
  stage.append(container);
  const profile = current();
  if (!profile) {
    ctx = undefined;
    container.append(
      empty('server', 'No server yet', 'Install a new FiveM server or add an existing one to get started.', button('New server', newServer, { kind: 'primary', icon: 'plus' })),
    );
    return;
  }
  ctx = { profile, state: () => stateOf(profile.id), reloadProfiles };
  cleanup = PAGES.find((p) => p.key === currentPage)!.page(container, ctx);
}

function navigate(page: string) {
  if (page === currentPage) return;
  currentPage = page;
  renderSidebar();
  mountPage();
}

function select(id: string | undefined) {
  if (id === currentId) return;
  currentId = id;
  call('settings:set', { lastProfileId: id });
  renderSidebar();
  renderHeader();
  mountPage();
}

async function reloadProfiles(selectId?: string) {
  profiles = (await call<Profile[]>('profiles:list')) ?? [];
  const target = selectId ?? (profiles.some((p) => p.id === currentId) ? currentId : profiles[0]?.id);
  if (target !== currentId) return select(target);
  const profile = current();
  if (ctx && profile) ctx.profile = profile;
  renderSidebar();
  renderHeader();
}

function newServer() {
  openWizard(async (profile) => {
    await reloadProfiles(profile.id);
  });
}

function closeRequest() {
  const m = modal({
    title: 'Servers are still running',
    body: h('p', { class: 'muted' }, 'Local servers are still running. Stop them and quit, or keep them running in the system tray? Remote servers keep running either way.'),
    actions: [
      { label: 'Cancel', kind: 'ghost', onClick: () => m.close() },
      { label: 'Keep running in tray', onClick: () => (m.close(), call('app:close', 'tray')) },
      { label: 'Stop local servers and quit', kind: 'danger', onClick: () => (m.close(), toast('info', 'Stopping servers…'), call('app:close', 'stop')) },
    ],
  });
}

async function init() {
  document.body.append(
    h(
      'div',
      { class: 'app' },
      h('div', { class: 'titlebar' }, h('span', { class: 'brand-mark' }), h('span', { class: 'brand' }, '0x-5mServerControl')),
      h('aside', { class: 'sidebar' }, h('div', { class: 'section-label' }, 'Servers'), serverList, h('div', { class: 'section-label' }, 'Manage'), nav),
      h('main', { class: 'main' }, header, stage),
    ),
  );
  settings = (await call<AppSettings>('settings:get')) ?? settings;
  applySettings(settings);
  for (const state of (await call<ServerState[]>('server:states')) ?? []) states.set(state.profileId, state);
  profiles = (await call<Profile[]>('profiles:list')) ?? [];
  currentId = profiles.find((p) => p.id === settings.lastProfileId)?.id ?? profiles[0]?.id;
  renderSidebar();
  renderHeader();
  mountPage();

  api.on('server:state', (state: ServerState) => {
    states.set(state.profileId, state);
    renderSidebar();
    if (state.profileId === currentId) renderHeader();
  });
  api.on('app:toast', (t: { type: 'info' | 'success' | 'error'; message: string }) => toast(t.type, t.message));
  api.on('app:close-request', closeRequest);
}

init();
