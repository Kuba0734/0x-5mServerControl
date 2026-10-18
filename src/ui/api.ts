import { errorMessage, toast } from './dom.js';

interface Bridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, listener: (...args: any[]) => void): () => void;
  pathForFile(file: File): string;
}

export const api = (window as unknown as { api: Bridge }).api;

export async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T | undefined> {
  try {
    return await api.invoke<T>(channel, ...args);
  } catch (error) {
    toast('error', errorMessage(error));
    return undefined;
  }
}

export async function run(channel: string, ...args: unknown[]) {
  try {
    await api.invoke(channel, ...args);
    return true;
  } catch (error) {
    toast('error', errorMessage(error));
    return false;
  }
}
