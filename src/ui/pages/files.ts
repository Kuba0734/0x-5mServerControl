import type { FileEntry } from '../../shared/types.js';
import { api, call, run } from '../api.js';
import { button, confirmDialog, empty, formatBytes, h, icon, iconButton, promptDialog, skeleton, stagger, toast } from '../dom.js';
import { createEditor, languageFor } from '../editor.js';
import type { Page } from '../context.js';

const TEXT = /\.(lua|json|cfg|sql|txt|md|js|ts|html|css|xml|yml|yaml|ini|log|meta)$/i;

function join(dir: string, name: string) {
  return dir ? `${dir}/${name}` : name;
}

export const filesPage: Page = (root, ctx) => {
  const id = ctx.profile.id;
  const remote = !!ctx.profile.host;
  const trashLabel = remote ? 'Move to trash folder' : 'Move to Recycle Bin';
  let dir = '';
  let entries: FileEntry[] = [];
  let staggerNext = true;

  const address = h('input', { class: 'input address', spellcheck: false }) as HTMLInputElement;
  const list = h('div', { class: 'list files-list' }, skeleton(8));
  const body = h('div', { class: 'files-body' }, list);

  const go = (next: string) => {
    dir = next.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    staggerNext = true;
    load();
  };

  const load = async () => {
    address.value = '/' + dir;
    const result = await call<FileEntry[]>('files:list', id, dir);
    if (!result) {
      if (dir) go(dir.split('/').slice(0, -1).join('/'));
      return;
    }
    entries = result;
    render();
  };

  const act = async (channel: string, ...args: unknown[]) => {
    const ok = await run(channel, id, ...args);
    await load();
    return ok;
  };

  const openFile = async (entry: FileEntry) => {
    const rel = join(dir, entry.name);
    if (!TEXT.test(entry.name)) return remote ? toast('info', 'This file type cannot be edited here') : call('files:reveal', id, rel);
    const content = await call<string>('files:read', id, rel);
    if (content === undefined) return;
    const save = async () => {
      if (await run('files:write', id, rel, editor.value)) toast('success', `${entry.name} saved`);
    };
    const editor = createEditor(content, languageFor(entry.name), save);
    const close = () => body.replaceChildren(list);
    body.replaceChildren(
      h(
        'div',
        { class: 'file-editor panel fade-in' },
        h('div', { class: 'toolbar' }, icon('file'), h('strong', {}, rel), h('div', { class: 'spacer' }), button('Save', save, { kind: 'primary', icon: 'save' }), button('Close', close, { kind: 'ghost' })),
        editor.root,
      ),
    );
    editor.focus();
  };

  const rowFor = (entry: FileEntry) => {
    const rel = join(dir, entry.name);
    const isZip = /\.zip$/i.test(entry.name);
    return h(
      'div',
      { class: 'row', tabindex: '0', onDblclick: () => (entry.dir ? go(rel) : openFile(entry)), onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && (entry.dir ? go(rel) : openFile(entry)) },
      icon(entry.dir ? 'folder' : isZip ? 'zip' : 'file'),
      h('div', { class: 'row-main' }, h('strong', {}, entry.name)),
      h('span', { class: 'muted small mono' }, entry.dir ? '' : formatBytes(entry.size)),
      h('span', { class: 'muted small' }, new Date(entry.mtime).toLocaleString()),
      h(
        'div',
        { class: 'row-actions' },
        isZip ? iconButton('zip', 'Extract', () => act('files:extract', rel)) : null,
        entry.dir ? iconButton('zip', 'Pack as ZIP', () => act('files:pack', rel)) : null,
        !entry.dir && TEXT.test(entry.name) ? iconButton('edit', 'Edit', () => openFile(entry)) : null,
        remote ? null : iconButton('external', 'Show in Explorer', () => call('files:reveal', id, rel)),
        iconButton('sliders', 'Rename', async () => {
          const name = await promptDialog('Rename', 'New name', entry.name);
          if (name && name !== entry.name) act('files:rename', rel, name);
        }),
        iconButton('trash', trashLabel, async () => {
          const where = remote ? 'the trash folder on the server (~/.fxsc/<profile>/trash)' : 'the Windows Recycle Bin';
          if (await confirmDialog(trashLabel, `Move "${entry.name}" to ${where}?`, trashLabel, true)) act('files:trash', rel);
        }),
      ),
    );
  };

  const render = () => {
    if (!entries.length) return list.replaceChildren(empty('folder', 'This folder is empty', 'Drop files here to import them.'));
    const rows = entries.map(rowFor);
    list.replaceChildren(...(staggerNext ? stagger(rows) : rows));
    staggerNext = false;
  };

  address.addEventListener('keydown', (e) => e.key === 'Enter' && go(address.value));

  const create = async (folder: boolean) => {
    const name = await promptDialog(folder ? 'New folder' : 'New file', 'Name');
    if (name) act('files:create', dir, name, folder);
  };

  body.addEventListener('dragover', (e) => {
    e.preventDefault();
    body.classList.add('drop');
  });
  body.addEventListener('dragleave', (e) => {
    if (!body.contains(e.relatedTarget as Node)) body.classList.remove('drop');
  });
  body.addEventListener('drop', async (e) => {
    e.preventDefault();
    body.classList.remove('drop');
    const paths = [...(e.dataTransfer?.files ?? [])].map((file) => api.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    if (await act('files:import', dir, paths)) toast('success', `Imported ${paths.length} item${paths.length > 1 ? 's' : ''}`);
  });

  root.append(
    h(
      'div',
      { class: 'page-files' },
      h(
        'div',
        { class: 'toolbar' },
        iconButton('up', 'Up one level', () => go(dir.split('/').slice(0, -1).join('/'))),
        iconButton('refresh', 'Refresh', load),
        h('div', { class: 'address-bar' }, icon('folder'), address),
        iconButton('file', 'New file', () => create(false)),
        iconButton('folder', 'New folder', () => create(true)),
        remote ? null : iconButton('external', 'Open in Explorer', () => call('files:reveal', id, dir)),
      ),
      body,
    ),
  );
  load();
};
