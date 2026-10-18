import type { ArtifactChannel, ArtifactVersions, BaseKind, HostConfig, InstallOptions, Profile, ServerMode } from '../shared/types.js';
import { api, call, run } from './api.js';
import { button, field, h, icon, input, modal, segmented, stagger, toast } from './dom.js';
import { hostForm } from './host-form.js';

const BASES: [BaseKind, string, string][] = [
  ['existing', 'Existing server-data', 'Use a server-data folder you already have'],
  ['vanilla', 'Vanilla', 'cfx-server-data default resources, no framework'],
  ['esx', 'ESX Legacy', 'Popular roleplay framework, needs MySQL / MariaDB'],
  ['qbcore', 'QBCore', 'Roleplay framework with jobs and gangs, needs MySQL / MariaDB'],
  ['qbox', 'Qbox', 'Modern QBCore-compatible framework, needs MySQL / MariaDB'],
];

export function folderInput(value: string, onChange: (value: string) => void, placeholder = '', browse = true) {
  const control = input(value, onChange, { placeholder });
  return h(
    'div',
    { class: 'input-group' },
    control,
    browse
      ? button('Browse', async () => {
          const folder = await call<string>('dialog:folder');
          if (folder) {
            control.value = folder;
            onChange(folder);
          }
        })
      : null,
  );
}

export function openWizard(onDone: (profile: Profile) => void) {
  const opts: InstallOptions = {
    name: 'My FiveM Server',
    mode: 'direct',
    artifacts: { kind: 'download', channel: 'recommended', path: '' },
    base: 'vanilla',
    serverDataPath: '',
    hostname: 'My FiveM Server',
    licenseKey: '',
    maxClients: 48,
    port: 30120,
    db: { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'fivem' },
  };
  const host: HostConfig = { address: '', port: 22, username: 'root', password: '', os: 'linux' };
  const form = hostForm(host);
  let location: 'local' | 'remote' = 'local';
  let channel: ArtifactChannel = 'recommended';
  let build = '';
  let artifactsKind: 'download' | 'existing' = 'download';
  let versions: ArtifactVersions | undefined;
  let versionsOs = '';
  let step = 0;
  const remote = () => location === 'remote';
  const os = () => (remote() ? host.os : 'windows');
  const needsDb = () => opts.base !== 'existing' && opts.base !== 'vanilla';
  const examples = () =>
    os() === 'linux' ? ['/home/fivem/artifacts', '/home/fivem/server-data'] : remote() ? ['C:/FXServer/artifacts', 'C:/FXServer/server-data'] : ['C:\\FXServer\\artifacts', 'C:\\FXServer\\server-data'];

  const loadVersions = () => {
    if (versionsOs === os()) return;
    versionsOs = os();
    versions = undefined;
    build = '';
    call<ArtifactVersions>('artifacts:versions', os()).then((v) => (versions = v));
  };

  const steps: { title: string; render: () => Node[]; validate?: () => string | undefined }[] = [
    {
      title: 'Location',
      render: () => {
        const details = h('div', { class: 'stack' });
        const renderDetails = () =>
          details.replaceChildren(
            ...(remote()
              ? [h('p', { class: 'muted small' }, 'Linux and Windows servers are managed over SSH. Windows needs the OpenSSH server feature. Linux needs screen, curl and tar.'), form.root]
              : [h('p', { class: 'muted small' }, 'The server runs on this computer.')]),
          );
        renderDetails();
        return [field('Where does the server run?', segmented<'local' | 'remote'>([['local', 'This computer'], ['remote', 'Remote (SSH)']], location, (v) => ((location = v), renderDetails()))), details];
      },
      validate: () => {
        if (remote() && !form.tested()) return 'Test the SSH connection first';
        loadVersions();
      },
    },
    {
      title: 'Basics',
      render: () => [
        field('Profile name', input(opts.name, (v) => (opts.name = v))),
        field('Mode', segmented<ServerMode>([['direct', 'Direct (server.cfg)'], ['txadmin', 'txAdmin']], opts.mode, (v) => (opts.mode = v)), 'txAdmin mode starts FXServer with the txAdmin web panel.'),
      ],
      validate: () => (opts.name.trim() ? undefined : 'Enter a profile name'),
    },
    {
      title: 'Artifacts',
      render: () => {
        const details = h('div', { class: 'stack' });
        const binary = os() === 'linux' ? 'run.sh' : 'FXServer.exe';
        const renderDetails = () => {
          if (artifactsKind === 'existing') return details.replaceChildren(field(`Artifacts folder (contains ${binary})`, folderInput(opts.artifacts.path, (v) => (opts.artifacts.path = v), examples()[0], !remote())));
          const select = h('select', { class: 'input', onChange: (e: Event) => (build = (e.target as HTMLSelectElement).value) }, ...(versions?.builds ?? []).map((b) => h('option', { value: b, selected: b === build }, b)));
          if (!build && versions?.builds[0]) build = versions.builds[0];
          details.replaceChildren(
            field(
              'Channel',
              segmented<ArtifactChannel>([['recommended', `Recommended${versions ? ` (${versions.recommended})` : ''}`], ['latest', `Latest${versions ? ` (${versions.latest})` : ''}`], ['build', 'Specific build']], channel, (v) => ((channel = v), renderDetails())),
            ),
            channel === 'build' ? field('Build', select) : '',
            field('Install artifacts to', folderInput(opts.artifacts.path, (v) => (opts.artifacts.path = v), examples()[0], !remote()), remote() ? 'Path on the remote server.' : undefined),
          );
        };
        renderDetails();
        return [field('Source', segmented<'download' | 'existing'>([['download', 'Download'], ['existing', 'Existing folder']], artifactsKind, (v) => ((artifactsKind = v), renderDetails()))), details];
      },
      validate: () => (opts.artifacts.path.trim() ? undefined : 'Choose an artifacts folder'),
    },
    {
      title: 'Server data',
      render: () => {
        const cards = BASES.map(([key, title, text]) =>
          h(
            'button',
            { type: 'button', class: `choice${opts.base === key ? ' active' : ''}`, onClick: (e: Event) => ((opts.base = key), cards.forEach((c) => c.classList.toggle('active', c === e.currentTarget))) },
            h('strong', {}, title),
            h('span', { class: 'muted small' }, text),
          ),
        );
        return [
          h('div', { class: 'choices' }, ...stagger(cards)),
          field('server-data folder', folderInput(opts.serverDataPath, (v) => (opts.serverDataPath = v), examples()[1], !remote()), 'For a new server this folder must be empty or not exist yet.'),
        ];
      },
      validate: () => (opts.serverDataPath.trim() ? undefined : 'Choose a server-data folder'),
    },
    {
      title: 'Configuration',
      render: () => {
        const nodes: Node[] = [];
        if (opts.base !== 'existing') {
          nodes.push(
            field('Server name', input(opts.hostname, (v) => (opts.hostname = v))),
            field('License key', input(opts.licenseKey, (v) => (opts.licenseKey = v.trim()), { placeholder: 'cfxk_…' }), 'Create one at portal.cfx.re'),
            h('div', { class: 'grid-2' }, field('Max players', input(opts.maxClients, (v) => (opts.maxClients = Number(v)), { type: 'number', min: 1, max: 2048 })), field('Port', input(opts.port, (v) => (opts.port = Number(v)), { type: 'number', min: 1, max: 65535 }))),
          );
        } else {
          nodes.push(field('Port', input(opts.port, (v) => (opts.port = Number(v)), { type: 'number' }), 'Only used when server.cfg has no endpoint_add_tcp line.'));
        }
        if (needsDb()) {
          const db = opts.db!;
          const status = h('span', { class: 'muted small' });
          nodes.push(
            h('div', { class: 'divider' }),
            h('h4', {}, 'Database (MySQL / MariaDB)'),
            ...(remote() ? [h('p', { class: 'muted small' }, 'The database is reached through the SSH connection, so 127.0.0.1 means the remote server.')] : []),
            h('div', { class: 'grid-2' }, field('Host', input(db.host, (v) => (db.host = v))), field('Port', input(db.port, (v) => (db.port = Number(v)), { type: 'number' }))),
            h('div', { class: 'grid-2' }, field('User', input(db.user, (v) => (db.user = v))), field('Password', input(db.password, (v) => (db.password = v), { type: 'password' }))),
            field('Database name', input(db.database, (v) => (db.database = v)), 'Created automatically if it does not exist.'),
            h(
              'div',
              { class: 'actions' },
              status,
              button('Test connection', async () => {
                status.textContent = 'Connecting…';
                status.textContent = (await run('install:test-db', db, remote() ? host : undefined)) ? 'Connection works' : 'Connection failed';
              }, { icon: 'check' }),
            ),
          );
        }
        return nodes;
      },
      validate: () => {
        if (opts.base !== 'existing' && !opts.licenseKey) return 'Enter a license key';
        if (!(opts.port > 0 && opts.port < 65536)) return 'Enter a valid port';
        if (needsDb() && !(opts.db!.host && opts.db!.user && /^\w+$/.test(opts.db!.database))) return 'Complete the database settings';
      },
    },
  ];

  const progress = h('div', { class: 'wizard-steps' });
  const content = h('div', { class: 'wizard-content' });
  const m = modal({ title: 'New server', body: [progress, content], wide: true, dismissable: true, onClose: () => offLog() });
  const offLog = api.on('install:log', (text: string) => {
    const log = content.querySelector('.log');
    if (!log) return;
    log.textContent += text + '\n';
    log.scrollTop = log.scrollHeight;
  });

  const install = async () => {
    opts.artifacts = artifactsKind === 'download' ? { kind: 'download', channel, build: channel === 'build' ? build : undefined, path: opts.artifacts.path } : { kind: 'existing', path: opts.artifacts.path };
    const payload: InstallOptions = { ...opts, db: needsDb() ? opts.db : undefined, host: remote() ? host : undefined };
    progress.replaceChildren(h('span', { class: 'active' }, 'Installing'));
    content.replaceChildren(h('div', { class: 'install-status' }, h('div', { class: 'spinner' }), h('span', {}, 'Installing, this can take a few minutes…')), h('pre', { class: 'log' }));
    m.setActions([]);
    let profile: Profile | undefined;
    try {
      profile = await api.invoke<Profile>('install:run', payload);
    } catch (error) {
      content.querySelector('.install-status')!.replaceChildren(icon('alert'), h('span', { class: 'danger' }, String((error as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
      m.setActions([{ label: 'Back', kind: 'ghost', onClick: () => render() }]);
      return;
    }
    content.querySelector('.install-status')!.replaceChildren(icon('check'), h('span', { class: 'success' }, 'Server installed'));
    toast('success', `${profile.name} is ready`);
    onDone(profile);
    m.setActions([{ label: 'Open server', kind: 'primary', onClick: () => m.close() }]);
  };

  function render() {
    progress.replaceChildren(...steps.map((s, i) => h('span', { class: i === step ? 'active' : i < step ? 'done' : '' }, `${i + 1}. ${s.title}`)));
    content.replaceChildren(h('div', { class: 'stack fade-in' }, ...steps[step].render()));
    const last = step === steps.length - 1;
    m.setActions([
      { label: step ? 'Back' : 'Cancel', kind: 'ghost', onClick: () => (step ? (step--, render()) : m.close()) },
      {
        label: last ? 'Install' : 'Next',
        kind: 'primary',
        onClick: () => {
          const problem = steps[step].validate?.();
          if (problem) return toast('error', problem);
          if (last) install();
          else (step++, render());
        },
      },
    ]);
  }
  render();
}
