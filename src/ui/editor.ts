import { h } from './dom.js';

type Rule = [string, string];

const str = `"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'`;
const num = '\\b\\d+(?:\\.\\d+)?\\b';

const languages: Record<string, Rule[]> = {
  lua: [
    ['comment', '--\\[\\[[\\s\\S]*?\\]\\]|--.*'],
    ['string', `${str}|\\[\\[[\\s\\S]*?\\]\\]`],
    ['keyword', '\\b(?:and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\\b'],
    ['number', num],
  ],
  json: [
    ['string', str],
    ['keyword', '\\b(?:true|false|null)\\b'],
    ['number', `-?${num}`],
  ],
  cfg: [
    ['comment', '#.*|//.*'],
    ['string', str],
    ['keyword', '^\\s*(?:ensure|start|stop|restart|exec|set|sets|setr|add_ace|add_principal|remove_ace|remove_principal|endpoint_add_tcp|endpoint_add_udp|sv_hostname|sv_licenseKey|sv_maxclients|sv_enforceGameBuild|load_server_icon)\\b'],
    ['number', num],
  ],
  sql: [
    ['comment', '--.*|#.*|/\\*[\\s\\S]*?\\*/'],
    ['string', `${str}|\`[^\`]*\``],
    ['keyword', '\\b(?:select|from|where|insert|into|values|update|set|delete|create|table|drop|alter|add|primary|key|foreign|references|not|null|default|auto_increment|int|varchar|text|longtext|tinyint|bigint|datetime|timestamp|if|exists|engine|charset|unique|index|and|or|on|join|left|right|inner|order|by|group|limit)\\b'],
    ['number', num],
  ],
};

const extensions: Record<string, string> = { lua: 'lua', json: 'json', cfg: 'cfg', sql: 'sql' };

export function languageFor(name: string) {
  return extensions[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'text';
}

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(code: string, language: string) {
  const rules = languages[language];
  if (!rules) return escape(code);
  const pattern = new RegExp(rules.map(([, source]) => `(${source})`).join('|'), language === 'sql' ? 'gim' : 'gm');
  let out = '';
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const group = match.slice(1).findIndex((g) => g !== undefined);
    out += escape(code.slice(last, match.index)) + `<span class="tok-${rules[group][0]}">${escape(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return out + escape(code.slice(last));
}

export function createEditor(value: string, language: string, onSave?: () => void) {
  const code = h('code');
  const pre = h('pre', { class: 'editor-highlight', 'aria-hidden': 'true' }, code);
  const textarea = h('textarea', { class: 'editor-input', spellcheck: false, wrap: 'off' }) as HTMLTextAreaElement;
  const root = h('div', { class: 'editor' }, pre, textarea);
  let frame = 0;
  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => (code.innerHTML = highlight(textarea.value, language) + '\n'));
  };
  textarea.value = value;
  textarea.addEventListener('input', render);
  textarea.addEventListener('scroll', () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
      render();
    } else if (e.key === 's' && e.ctrlKey) {
      e.preventDefault();
      onSave?.();
    }
  });
  code.innerHTML = highlight(value, language) + '\n';
  return {
    root,
    get value() {
      return textarea.value;
    },
    set value(next: string) {
      textarea.value = next;
      render();
    },
    focus: () => textarea.focus(),
  };
}
