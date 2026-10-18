export interface Segment {
  text: string;
  color: number;
}

const token = /\^(\d)|\x1b\[([\d;]*)m|\x1b\[[\d;?]*[A-Za-z]/g;

const ansiToFivem = [9, 1, 2, 3, 4, 6, 5, 0];

function ansiColor(params: string, current: number) {
  let color = current;
  const codes = params.split(';').map(Number);
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 38 || code === 48) i += codes[i + 1] === 2 ? 4 : 2;
    else if (code === 0 || code === 39 || Number.isNaN(code)) color = -1;
    else if (code >= 30 && code <= 37) color = ansiToFivem[code - 30];
    else if (code >= 90 && code <= 97) color = ansiToFivem[code - 90];
  }
  return color;
}

export function parseLine(line: string): Segment[] {
  const segments: Segment[] = [];
  let color = -1;
  let last = 0;
  const push = (end: number) => {
    if (end > last) segments.push({ text: line.slice(last, end), color });
  };
  for (const match of line.matchAll(token)) {
    push(match.index);
    last = match.index + match[0].length;
    if (match[1] !== undefined) color = Number(match[1]);
    else if (match[2] !== undefined) color = ansiColor(match[2], color);
  }
  push(line.length);
  return segments;
}

export function stripColors(line: string) {
  return line.replace(token, '');
}
