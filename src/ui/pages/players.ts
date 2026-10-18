import type { Player } from '../../shared/types.js';
import { api, call } from '../api.js';
import { button, empty, h, promptDialog, skeleton, stagger, toast } from '../dom.js';
import type { Page } from '../context.js';

export const playersPage: Page = (root, ctx) => {
  const id = ctx.profile.id;
  const list = h('div', { class: 'list' }, skeleton(4));
  let shown = '';

  const kick = async (player: Player) => {
    const reason = await promptDialog(`Kick ${player.name}`, 'Reason', 'Kicked by an administrator');
    if (reason === undefined) return;
    await call('server:command', id, `clientkick ${player.id} ${reason.replace(/[\r\n]/g, ' ')}`);
    toast('success', `${player.name} was kicked`);
  };

  const render = (players: Player[]) => {
    const key = ctx.state().status + JSON.stringify(players);
    if (key === shown) return;
    const first = !shown;
    shown = key;
    if (ctx.state().status !== 'running') return list.replaceChildren(empty('users', 'Server is offline', 'Start the server to see connected players.'));
    if (!players.length) return list.replaceChildren(empty('users', 'No players online', 'Connected players will show up here.'));
    const rows = players.map((p) =>
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'badge' }, `#${p.id}`),
        h('div', { class: 'row-main' }, h('strong', {}, p.name), h('span', { class: 'muted small' }, p.identifiers.filter((i) => /^(license|discord|steam):/.test(i)).join('  ·  '))),
        h('span', { class: 'muted small mono' }, `${p.ping} ms`),
        button('Kick', () => kick(p), { kind: 'ghost', icon: 'kick' }),
      ),
    );
    list.replaceChildren(...(first ? stagger(rows) : rows));
  };

  root.append(h('div', { class: 'page-list' }, list));
  call<Player[]>('server:players', id).then((players) => render(players ?? []));
  const off = api.on('server:players', (profileId: string, players: Player[]) => profileId === id && render(players));
  const offState = api.on('server:state', () => call<Player[]>('server:players', id).then((players) => render(players ?? [])));
  return () => (off(), offState());
};
