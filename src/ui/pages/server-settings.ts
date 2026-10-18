import { call, run } from '../api.js';
import { button, empty, h, icon, stagger, toast } from '../dom.js';
import { createEditor } from '../editor.js';
import type { Page } from '../context.js';

export const serverSettingsPage: Page = (root, ctx) => {
  const id = ctx.profile.id;
  const editor = createEditor('', 'cfg', () => saveCfg());
  const ensureList = h('div', { class: 'ensure-list' });
  let order: string[] = [];
  let dragIndex = -1;

  const loadAll = async () => {
    const text = await call<string>('files:read', id, 'server.cfg');
    editor.value = text ?? '';
    order = (await call<string[]>('resources:ensure-get', id)) ?? [];
    renderEnsure(true);
  };

  async function saveCfg() {
    if (await run('files:write', id, 'server.cfg', editor.value)) {
      toast('success', 'server.cfg saved');
      order = (await call<string[]>('resources:ensure-get', id)) ?? [];
      renderEnsure(false);
    }
  }

  const saveOrder = async () => {
    if (await run('resources:ensure-set', id, order)) {
      toast('success', 'Start order saved');
      editor.value = (await call<string>('files:read', id, 'server.cfg')) ?? editor.value;
    }
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return;
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    renderEnsure(false);
    (ensureList.children[to] as HTMLElement | undefined)?.focus();
  };

  function renderEnsure(animate: boolean) {
    if (!order.length) return ensureList.replaceChildren(empty('box', 'No ensure lines', 'Add "ensure <resource>" lines to server.cfg.'));
    const rows = order.map((name, index) => {
      const row = h(
        'div',
        {
          class: 'ensure-row',
          draggable: 'true',
          tabindex: '0',
          title: 'Drag to reorder, or use Alt + Arrow keys',
          onDragstart: (e: DragEvent) => {
            dragIndex = index;
            e.dataTransfer!.effectAllowed = 'move';
            row.classList.add('dragging');
          },
          onDragend: () => row.classList.remove('dragging'),
          onDragover: (e: DragEvent) => {
            e.preventDefault();
            row.classList.add('drag-over');
          },
          onDragleave: () => row.classList.remove('drag-over'),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            move(dragIndex, index);
          },
          onKeydown: (e: KeyboardEvent) => {
            if (e.altKey && e.key === 'ArrowUp') move(index, index - 1);
            if (e.altKey && e.key === 'ArrowDown') move(index, index + 1);
          },
        },
        icon('grip'),
        h('span', { class: 'muted small mono' }, String(index + 1).padStart(2, '0')),
        h('span', { class: 'mono' }, name),
      );
      return row;
    });
    ensureList.replaceChildren(...(animate ? stagger(rows) : rows));
  }

  root.append(
    h(
      'div',
      { class: 'page-split' },
      h(
        'section',
        { class: 'panel split-main' },
        h('div', { class: 'toolbar' }, icon('file'), h('strong', {}, 'server.cfg'), h('div', { class: 'spacer' }), button('Reload', loadAll, { kind: 'ghost', icon: 'refresh' }), button('Save', saveCfg, { kind: 'primary', icon: 'save' })),
        editor.root,
      ),
      h(
        'section',
        { class: 'panel split-side' },
        h('div', { class: 'toolbar' }, icon('box'), h('strong', {}, 'Start order'), h('div', { class: 'spacer' }), button('Save', saveOrder, { kind: 'primary', icon: 'save' })),
        h('p', { class: 'muted small pad' }, 'Resources start in this order. Drag to reorder.'),
        ensureList,
      ),
    ),
  );
  loadAll();
};
