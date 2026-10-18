import type { ResourceInfo } from '../../shared/types.js';
import { api, call } from '../api.js';
import { empty, h, icon, iconButton, skeleton, stagger } from '../dom.js';
import type { Page } from '../context.js';

export const resourcesPage: Page = (root, ctx) => {
  const id = ctx.profile.id;
  const list = h('div', { class: 'list' }, skeleton(8));
  let resources: ResourceInfo[] = [];
  let query = '';
  let first = true;

  const action = (verb: string, name: string) => call('server:command', id, `${verb} ${name}`);

  const render = () => {
    const running = ctx.state().status === 'running';
    const visible = resources.filter((r) => !query || `${r.category}/${r.name}`.toLowerCase().includes(query));
    if (!visible.length) return list.replaceChildren(empty('box', 'No resources found', query ? 'Try a different filter.' : 'Add resources to the resources folder of this server.'));
    const rows: HTMLElement[] = [];
    let category: string | undefined;
    for (const r of visible) {
      if (r.category !== category) {
        category = r.category;
        rows.push(h('div', { class: 'list-group' }, category || 'resources'));
      }
      rows.push(
        h(
          'div',
          { class: 'row' },
          h('span', { class: `dot${r.started ? ' on' : ''}`, title: r.started ? 'Started' : 'Stopped' }),
          h('div', { class: 'row-main' }, h('strong', {}, r.name)),
          h(
            'div',
            { class: `row-actions${running ? '' : ' disabled'}` },
            iconButton('play', 'Start', () => action('start', r.name)),
            iconButton('stop', 'Stop', () => action('stop', r.name)),
            iconButton('restart', 'Restart', () => action('restart', r.name)),
            iconButton('check', 'Ensure', () => action('ensure', r.name)),
          ),
        ),
      );
    }
    list.replaceChildren(...(first ? stagger(rows) : rows));
    first = false;
  };

  const load = async () => {
    resources = (await call<ResourceInfo[]>('resources:list', id)) ?? [];
    render();
  };

  const search = h('input', { class: 'input', placeholder: 'Filter resources', onInput: (e: Event) => ((query = (e.target as HTMLInputElement).value.toLowerCase()), render()) });
  root.append(
    h(
      'div',
      { class: 'page-list' },
      h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), h('div', { class: 'spacer' }), iconButton('refresh', 'Refresh', load)),
      list,
    ),
  );
  load();
  let timer = 0;
  const off = api.on('server:resources', (profileId: string) => {
    if (profileId !== id) return;
    clearTimeout(timer);
    timer = window.setTimeout(load, 300);
  });
  const offState = api.on('server:state', render);
  return () => (off(), offState(), clearTimeout(timer));
};
