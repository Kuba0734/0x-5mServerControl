import type { Profile, ServerState } from '../shared/types.js';

export interface PageContext {
  profile: Profile;
  state(): ServerState;
  reloadProfiles(selectId?: string): Promise<void>;
}

export type Page = (root: HTMLElement, ctx: PageContext) => (() => void) | void;
