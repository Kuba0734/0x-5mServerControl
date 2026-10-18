import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function download(url: string, dest: string, onProgress?: (received: number, total: number) => void) {
  const res = await fetch(url, { headers: { 'User-Agent': '0x-5mServerControl' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onProgress?.(received, total);
  });
  await pipeline(body, fs.createWriteStream(dest));
}

export async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': '0x-5mServerControl' } });
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return res.text();
}

function tar(args: string[]) {
  return new Promise<void>((resolve, reject) =>
    execFile('tar.exe', args, { windowsHide: true, maxBuffer: 1 << 26 }, (error, _out, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve())),
  );
}

export async function unzip(file: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  await tar(['-xf', file, '-C', dest]);
}

export async function zipFolder(folder: string, dest: string) {
  await tar(['-a', '-cf', dest, '-C', path.dirname(folder), path.basename(folder)]);
}
