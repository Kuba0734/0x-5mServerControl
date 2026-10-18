import type { AppSettings, Profile, ServerMode, UpdateInfo, ValidationIssue } from '../../shared/types.js';
import { call, run } from '../api.js';
import { button, confirmDialog, field, h, icon, input, segmented, stagger, toast, toggle } from '../dom.js';
import type { Page } from '../context.js';
import { applySettings } from '../motion.js';
import { hostForm } from '../host-form.js';
import { folderInput } from '../wizard.js';

export const settingsPage: Page = (root, ctx) => {
  const { host: savedHost, ...rest } = ctx.profile;
  const draft: Omit<Profile, 'host'> = { ...rest };
  const host = savedHost ? { ...savedHost } : undefined;
  const hostSnapshot = JSON.stringify(host);
  const remote = !!host;
  const checks = h('div', { class: 'checks' });
  const updateBox = h('div', { class: 'update-box' }, h('p', { class: 'muted small' }, 'Check GitHub for a newer version of this app.'));
  let settings: AppSettings | undefined;
  const appSection = h('section', { class: 'panel card' }, h('h3', {}, 'App'));

  const saveProfile = async () => {
    const patch: Partial<Profile> = { ...draft, port: Number(draft.port), txAdminPort: Number(draft.txAdminPort) };
    if (host && JSON.stringify(host) !== hostSnapshot) patch.host = host;
    if (await run('profiles:update', draft.id, patch)) {
      toast('success', 'Profile saved');
      await ctx.reloadProfiles(draft.id);
    }
  };

  const removeProfile = async () => {
    if (!(await confirmDialog('Remove profile', `Remove "${draft.name}" from the app? Server files stay on disk.`, 'Remove', true))) return;
    if (await run('profiles:remove', draft.id)) {
      toast('success', 'Profile removed');
      await ctx.reloadProfiles();
    }
  };

  const runChecks = async () => {
    const issues = (await call<ValidationIssue[]>('server:validate', draft.id)) ?? [];
    checks.replaceChildren(
      ...stagger(issues.map((issue) => h('div', { class: `check ${issue.ok ? 'ok' : 'fail'}` }, icon(issue.ok ? 'check' : 'alert'), h('span', {}, issue.label), issue.detail ? h('span', { class: 'muted small mono' }, issue.detail) : null))),
    );
  };

  const setSetting = async (patch: Partial<AppSettings>) => {
    const next = await call<AppSettings>('settings:set', patch);
    if (next) applySettings(next);
  };

  const checkUpdate = async () => {
    updateBox.replaceChildren(h('p', { class: 'muted small' }, 'Checking for updates…'));
    const info = await call<UpdateInfo>('update:check');
    if (!info) return updateBox.replaceChildren(h('p', { class: 'muted small' }, 'Update check failed.'));
    if (!info.available || !info.url) return updateBox.replaceChildren(h('p', { class: 'muted small' }, `You are on the latest version (${info.current}).`));
    updateBox.replaceChildren(
      h('p', {}, `Version ${info.latest} is available (installed: ${info.current}).`),
      button('Install and restart', async () => {
        if (await confirmDialog('Install update', 'Running servers will be stopped and the app restarts.', 'Install')) {
          toast('info', 'Downloading update…');
          await run('update:apply', info.url);
        }
      }, { kind: 'primary', icon: 'download' }),
    );
  };

  call<AppSettings>('settings:get').then((value) => {
    settings = value;
    if (!settings) return;
    appSection.append(
      toggle(settings.animations, (animations) => setSetting({ animations }), 'Animations'),
      toggle(settings.launchAtLogin, (launchAtLogin) => setSetting({ launchAtLogin }), 'Launch at Windows login'),
      h('div', { class: 'divider' }),
      updateBox,
      h('div', { class: 'actions' }, button('Check for updates', checkUpdate, { icon: 'refresh' })),
    );
  });

  root.append(
    h(
      'div',
      { class: 'page-narrow' },
      h(
        'section',
        { class: 'panel card' },
        h('h3', {}, 'Server profile'),
        field('Name', input(draft.name, (v) => (draft.name = v))),
        field('FXServer artifacts folder', folderInput(draft.artifactsPath, (v) => (draft.artifactsPath = v), '', !remote)),
        field('server-data folder', folderInput(draft.serverDataPath, (v) => (draft.serverDataPath = v), '', !remote)),
        h(
          'div',
          { class: 'grid-2' },
          field('Server port', input(draft.port, (v) => (draft.port = Number(v)), { type: 'number', min: 1, max: 65535 }), 'Used when server.cfg has no endpoint'),
          field('txAdmin port', input(draft.txAdminPort, (v) => (draft.txAdminPort = Number(v)), { type: 'number', min: 1, max: 65535 })),
        ),
        field('Mode', segmented<ServerMode>([['direct', 'Direct (server.cfg)'], ['txadmin', 'txAdmin']], draft.mode, (v) => (draft.mode = v))),
        toggle(draft.autoStart, (v) => (draft.autoStart = v), 'Start this server when the app launches'),
        toggle(draft.autoRestart, (v) => (draft.autoRestart = v), 'Restart automatically after a crash (max. 3 times in 5 minutes)'),
        h('div', { class: 'actions' }, button('Remove profile', removeProfile, { kind: 'danger', icon: 'trash' }), h('div', { class: 'spacer' }), button('Save', saveProfile, { kind: 'primary', icon: 'save' })),
      ),
      host
        ? h(
            'section',
            { class: 'panel card' },
            h('h3', {}, 'Remote host (SSH)'),
            hostForm(host, 'Leave empty to keep the saved password', draft.id).root,
            h('p', { class: 'muted small' }, 'Changing the host requires the server to be stopped. Save the profile to apply.'),
          )
        : null,
      h('section', { class: 'panel card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Pre-start checks'), button('Run checks', runChecks, { kind: 'ghost', icon: 'check' })), checks),
      appSection,
    ),
  );
  runChecks();
};
