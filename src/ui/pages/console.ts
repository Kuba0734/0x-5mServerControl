import type { ConsoleLine } from '../../shared/types.js';
import { parseLine, stripColors } from '../../shared/colors.js';
import { api, call } from '../api.js';
import { h, icon, iconButton, segmented, toast } from '../dom.js';
import type { Page } from '../context.js';

const MAX_LINES = 5000;
const histories = new Map<string, string[]>();

function loadHistory(id: string) {
  if (!histories.has(id)) {
    let stored: string[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(`history:${id}`) ?? '[]');
    } catch {}
    histories.set(id, stored);
  }
  return histories.get(id)!;
}

function saveHistory(id: string, list: string[]) {
  try {
    localStorage.setItem(`history:${id}`, JSON.stringify(list.slice(-100)));
  } catch {}
}

type Level = 'all' | 'warn' | 'error';

function levelOf(line: ConsoleLine, plain: string) {
  if (line.err || /\berror\b|\bexception\b|\bfailed\b/i.test(plain)) return 2;
  if (/\bwarn(ing)?\b/i.test(plain)) return 1;
  return 0;
}

export const consolePage: Page = (root, ctx) => {
  const id = ctx.profile.id;
  const rowHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--console-row')) || 20;
  let lines: ConsoleLine[] = [];
  let view: ConsoleLine[] = [];
  let query = '';
  let level: Level = 'all';
  let stick = true;
  let frame = 0;

  const spacer = h('div', { class: 'console-spacer' });
  const rows = h('div', { class: 'console-rows' });
  const viewport = h('div', { class: 'console-viewport', tabindex: '0' }, spacer, rows);
  const count = h('span', { class: 'muted small' });
  const jump = h('button', { class: 'console-jump', type: 'button', onClick: () => ((stick = true), schedule()) }, icon('up', 14), 'Jump to latest');

  const matches = (line: ConsoleLine) => {
    const plain = stripColors(line.text);
    if (level !== 'all' && levelOf(line, plain) < (level === 'warn' ? 1 : 2)) return false;
    return !query || plain.toLowerCase().includes(query);
  };

  const rebuild = () => {
    view = query || level !== 'all' ? lines.filter(matches) : lines;
    schedule();
  };

  const renderRow = (line: ConsoleLine, index: number) => {
    const row = h('div', { class: `console-row${line.err ? ' err' : ''}`, style: { transform: `translateY(${index * rowHeight}px)` } });
    for (const segment of parseLine(line.text)) row.append(segment.color < 0 ? segment.text : h('span', { class: `c${segment.color}` }, segment.text));
    return row;
  };

  const render = () => {
    spacer.style.height = `${view.length * rowHeight}px`;
    if (stick) viewport.scrollTop = viewport.scrollHeight;
    const first = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - 10);
    const last = Math.min(view.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / rowHeight) + 10);
    rows.replaceChildren(...view.slice(first, last).map((line, i) => renderRow(line, first + i)));
    count.textContent = view.length === lines.length ? `${lines.length} lines` : `${view.length} of ${lines.length} lines`;
    jump.classList.toggle('visible', !stick);
  };

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }

  viewport.addEventListener('scroll', () => {
    stick = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - rowHeight;
    schedule();
  });
  const resize = new ResizeObserver(schedule);
  resize.observe(viewport);

  const history = loadHistory(id);
  let historyIndex = history.length;
  const command = h('input', { class: 'input console-input', placeholder: 'Type a command and press Enter', spellcheck: false }) as HTMLInputElement;
  command.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && command.value.trim()) {
      const text = command.value.trim();
      if (history[history.length - 1] !== text) history.push(text);
      saveHistory(id, history);
      historyIndex = history.length;
      command.value = '';
      stick = true;
      await call('server:command', id, text);
    } else if (e.key === 'ArrowUp' && historyIndex > 0) {
      e.preventDefault();
      command.value = history[--historyIndex];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      command.value = history[historyIndex] ?? '';
    }
  });

  const search = h('input', { class: 'input', placeholder: 'Filter output', spellcheck: false, onInput: (e: Event) => ((query = (e.target as HTMLInputElement).value.toLowerCase()), rebuild()) });

  const exportLog = () => {
    const blob = new Blob([lines.map((l) => `[${new Date(l.t).toISOString()}] ${stripColors(l.text)}`).join('\r\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    h('a', { href: url, download: `${ctx.profile.name.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const clear = () => {
    lines = [];
    rebuild();
    toast('info', 'Console view cleared');
  };

  root.append(
    h(
      'div',
      { class: 'page-console' },
      h(
        'div',
        { class: 'toolbar' },
        h('div', { class: 'search' }, icon('search'), search),
        segmented<Level>([['all', 'All'], ['warn', 'Warnings'], ['error', 'Errors']], 'all', (value) => ((level = value), rebuild())),
        h('div', { class: 'spacer' }),
        count,
        iconButton('trash', 'Clear view', clear),
        iconButton('download', 'Export log', exportLog),
      ),
      h('div', { class: 'console panel' }, viewport, jump),
      h('div', { class: 'console-command' }, icon('console'), command),
    ),
  );

  call<ConsoleLine[]>('server:console', id).then((initial = []) => {
    const first = lines[0]?.n ?? Infinity;
    lines = [...initial.filter((line) => line.n < first), ...lines].slice(-MAX_LINES);
    rebuild();
  });

  const off = api.on('server:console', (profileId: string, batch: ConsoleLine[]) => {
    if (profileId !== id) return;
    const last = lines[lines.length - 1]?.n ?? 0;
    lines.push(...batch.filter((line) => line.n > last));
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    rebuild();
  });

  return () => {
    off();
    resize.disconnect();
    cancelAnimationFrame(frame);
  };
};
