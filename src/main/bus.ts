import { EventEmitter } from 'node:events';
import { BrowserWindow } from 'electron';

export const events = new EventEmitter();

export function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args);
  events.emit(channel, ...args);
}

export function toast(type: 'info' | 'success' | 'error', message: string) {
  broadcast('app:toast', { type, message });
}
