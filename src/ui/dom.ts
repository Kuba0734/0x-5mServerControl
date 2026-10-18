type Child = Node | string | number | false | null | undefined;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Child | Child[])[]) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === 'class') el.className = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key in el && typeof value !== 'string') (el as any)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: (Child | Child[])[]) {
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

const icons: Record<string, string> = {
  play: '<path d="M7 5.5v13l11-6.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/>',
  console: '<path d="M4 6l5 5-5 5M12 18h8"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM11 6h2M11 9h2M11 12h2M11 15h2v3h-2z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 9v4M12 17h0M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  kick: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h0M7 16.5h0"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v6h8M7 21v-7h10v7"/>',
  rollback: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
};

export function icon(name: string, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] ?? ''}</svg>`;
  return span;
}

export function button(label: string, onClick: (event: MouseEvent) => unknown, opts: { kind?: 'primary' | 'ghost' | 'danger' | 'default'; icon?: string; disabled?: boolean; title?: string } = {}) {
  return h(
    'button',
    { class: `btn btn-${opts.kind ?? 'default'}`, onClick, disabled: opts.disabled, title: opts.title, type: 'button' },
    opts.icon ? icon(opts.icon) : null,
    label ? h('span', {}, label) : null,
  );
}

export function iconButton(name: string, title: string, onClick: (event: MouseEvent) => unknown, kind = 'ghost') {
  return h('button', { class: `btn btn-icon btn-${kind}`, title, 'aria-label': title, onClick, type: 'button' }, icon(name));
}

export function field(label: string, control: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function input(value: string | number, onInput: (value: string) => void, props: Props = {}) {
  return h('input', { class: 'input', value: String(value), onInput: (e: Event) => onInput((e.target as HTMLInputElement).value), ...props });
}

export function toggle(checked: boolean, onChange: (value: boolean) => void, label: string) {
  return h(
    'label',
    { class: 'toggle' },
    h('input', { type: 'checkbox', checked, onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
    h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })),
    h('span', {}, label),
  );
}

export function segmented<T extends string>(options: [T, string][], value: T, onChange: (value: T) => void) {
  const root = h('div', { class: 'segmented', role: 'tablist' });
  const render = (current: T) => {
    root.replaceChildren(
      ...options.map(([key, label]) =>
        h('button', { type: 'button', class: key === current ? 'active' : '', role: 'tab', 'aria-selected': String(key === current), onClick: () => (render(key), onChange(key)) }, label),
      ),
    );
  };
  render(value);
  return root;
}

export function stagger<T extends HTMLElement>(items: T[]) {
  items.forEach((item, i) => {
    item.classList.add('stagger');
    item.style.setProperty('--i', String(Math.min(i, 10)));
  });
  return items;
}

export function skeleton(rows = 5) {
  return h('div', { class: 'skeleton-list' }, ...Array.from({ length: rows }, () => h('div', { class: 'skeleton' })));
}

export function empty(iconName: string, title: string, text: string, action?: HTMLElement) {
  return h('div', { class: 'empty fade-in' }, h('div', { class: 'empty-icon' }, icon(iconName, 28)), h('h3', {}, title), h('p', {}, text), action ?? null);
}

function removeAfter(el: HTMLElement, className: string) {
  el.classList.add(className);
  const done = () => el.remove();
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
}

export function toast(type: 'info' | 'success' | 'error', message: string) {
  let host = document.getElementById('toasts');
  if (!host) document.body.append((host = h('div', { id: 'toasts', 'aria-live': 'polite' })));
  const el = h('div', { class: `toast toast-${type}`, role: 'status' }, icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'server'), h('span', {}, message), h('div', { class: 'toast-progress' }));
  const close = () => removeAfter(el, 'leaving');
  el.addEventListener('click', close);
  host.append(el);
  setTimeout(close, 4500);
}

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'ghost' | 'danger' | 'default';
  onClick: () => unknown;
}

export function modal(opts: { title: string; body: Node | Node[]; actions?: ModalAction[]; wide?: boolean; onClose?: () => void; dismissable?: boolean }) {
  const previous = document.activeElement as HTMLElement | null;
  const footer = h('div', { class: 'modal-actions' });
  const dialog = h(
    'div',
    { class: `modal${opts.wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
    h('div', { class: 'modal-head' }, h('h2', {}, opts.title), opts.dismissable === false ? null : iconButton('close', 'Close', () => close())),
    h('div', { class: 'modal-body' }, ...(Array.isArray(opts.body) ? opts.body : [opts.body])),
    footer,
  );
  const overlay = h('div', { class: 'overlay' }, dialog);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    removeAfter(overlay, 'leaving');
    opts.onClose?.();
    previous?.focus?.();
  };
  const setActions = (actions: ModalAction[]) => footer.replaceChildren(...actions.map((a) => button(a.label, a.onClick, { kind: a.kind })));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissable !== false) close();
  };
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && opts.dismissable !== false) close();
  });
  document.addEventListener('keydown', onKey);
  setActions(opts.actions ?? []);
  document.body.append(overlay);
  requestAnimationFrame(() => (dialog.querySelector('input, textarea, select, .btn-primary') as HTMLElement | null)?.focus());
  return { close, dialog, setActions, body: dialog.querySelector('.modal-body') as HTMLElement };
}

export function confirmDialog(title: string, text: string, confirmLabel = 'Confirm', danger = false) {
  return new Promise<boolean>((resolve) => {
    let result = false;
    const m = modal({
      title,
      body: h('p', { class: 'muted' }, text),
      onClose: () => resolve(result),
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => m.close() },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => ((result = true), m.close()) },
      ],
    });
  });
}

export function promptDialog(title: string, label: string, value = '') {
  return new Promise<string | undefined>((resolve) => {
    let result: string | undefined;
    const control = input(value, () => {});
    const submit = () => ((result = control.value.trim()), m.close());
    control.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    const m = modal({
      title,
      body: field(label, control),
      onClose: () => resolve(result || undefined),
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => m.close() },
        { label: 'OK', kind: 'primary', onClick: submit },
      ],
    });
    requestAnimationFrame(() => control.select());
  });
}

export function countUp(el: HTMLElement, to: number, format: (value: number) => string) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);
  const duration = Number(getComputedStyle(document.documentElement).getPropertyValue('--count-duration')) || 0;
  cancelAnimationFrame(Number(el.dataset.frame ?? 0));
  if (!duration || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) el.dataset.frame = String(requestAnimationFrame(step));
  };
  el.dataset.frame = String(requestAnimationFrame(step));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${d ? d + 'd ' : ''}${hh}:${mm}:${ss}`;
}

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
