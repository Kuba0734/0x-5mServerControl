import type { AppSettings } from '../shared/types.js';

export function applySettings(settings: AppSettings) {
  document.documentElement.dataset.motion = settings.animations ? 'on' : 'off';
}
