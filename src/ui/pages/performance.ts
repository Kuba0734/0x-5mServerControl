import type { ServerState, Stats } from '../../shared/types.js';
import { api, call } from '../api.js';
import { countUp, formatBytes, formatDuration, h, icon, stagger } from '../dom.js';
import type { Page } from '../context.js';

export const performancePage: Page = (root, ctx) => {
  const id = ctx.profile.id;
  const tile = (iconName: string, label: string) => {
    const value = h('div', { class: 'stat-value' }, '–');
    const bar = h('div', { class: 'stat-bar-fill' });
    const el = h('div', { class: 'stat panel' }, h('div', { class: 'stat-head' }, icon(iconName), h('span', {}, label)), value, h('div', { class: 'stat-bar' }, bar));
    return { el, value, bar };
  };
  const cpu = tile('chart', 'CPU');
  const memory = tile('server', 'Memory');
  const uptime = tile('restart', 'Uptime');
  const players = tile('users', 'Players');
  const note = h('p', { class: 'muted small' });

  const update = (stats: Stats) => {
    countUp(cpu.value, stats.cpu, (v) => `${v.toFixed(1)}%`);
    countUp(memory.value, stats.memory, formatBytes);
    countUp(players.value, stats.players, (v) => String(Math.round(v)));
    cpu.bar.style.transform = `scaleX(${stats.cpu / 100})`;
    memory.bar.style.transform = `scaleX(${Math.min(1, stats.memory / (8 * 1024 ** 3))})`;
  };

  const tick = () => {
    const state = ctx.state();
    uptime.value.textContent = state.startedAt ? formatDuration(Date.now() - state.startedAt) : '–';
    note.textContent = state.status === 'running' ? 'Updated every 2 seconds. CPU is relative to all cores.' : 'The server is not running.';
  };

  root.append(h('div', { class: 'page-performance' }, h('div', { class: 'stats' }, ...stagger([cpu.el, memory.el, uptime.el, players.el])), note));
  call<Stats>('server:stats', id).then((stats) => stats && update(stats));
  tick();
  const timer = setInterval(tick, 1000);
  const offStats = api.on('server:stats', (profileId: string, stats: Stats) => profileId === id && update(stats));
  const offState = api.on('server:state', (state: ServerState) => {
    if (state.profileId !== id) return;
    if (state.status === 'stopped') update({ cpu: 0, memory: 0, uptime: 0, players: 0 });
    tick();
  });
  return () => {
    clearInterval(timer);
    offStats();
    offState();
  };
};
