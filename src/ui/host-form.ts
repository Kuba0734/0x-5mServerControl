import type { HostConfig, HostOs } from '../shared/types.js';
import { call } from './api.js';
import { button, field, h, input } from './dom.js';

export function hostForm(config: HostConfig, passwordHint?: string, profileId?: string) {
  let tested = false;
  const status = h('span', { class: 'muted small' }, passwordHint ? `${config.os === 'linux' ? 'Linux' : 'Windows'} host` : 'Not tested yet');
  const changed = (apply: () => void) => () => {
    apply();
    tested = false;
    status.textContent = 'Not tested yet';
  };
  const bind = (key: 'address' | 'username' | 'password', label: string, props = {}) =>
    field(label, input(config[key], (v) => changed(() => (config[key] = v.trim()))(), props), key === 'password' ? passwordHint : undefined);

  const root = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'grid-2' }, bind('address', 'Host', { placeholder: 'server.example.com' }), field('SSH port', input(config.port, (v) => changed(() => (config.port = Number(v)))(), { type: 'number', min: 1, max: 65535 }))),
    h('div', { class: 'grid-2' }, bind('username', 'User'), bind('password', 'Password', { type: 'password', placeholder: passwordHint ? 'Unchanged' : '' })),
    h(
      'div',
      { class: 'actions' },
      status,
      button('Test connection', async () => {
        status.textContent = 'Connecting…';
        const result = await call<{ os: HostOs; fingerprint: string }>('host:test', { address: config.address, port: config.port, username: config.username, password: config.password }, profileId);
        if (!result) return (status.textContent = 'Connection failed');
        config.os = result.os;
        config.fingerprint = result.fingerprint;
        tested = true;
        status.textContent = `Connected, ${result.os === 'linux' ? 'Linux' : 'Windows'} host`;
      }, { icon: 'check' }),
    ),
  );
  return { root, tested: () => tested };
}
