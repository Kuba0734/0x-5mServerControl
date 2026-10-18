import type { ArtifactChannel, ArtifactVersions, Profile } from '../../shared/types.js';
import { api, call, run } from '../api.js';
import { button, confirmDialog, field, h, segmented, toast } from '../dom.js';
import type { Page } from '../context.js';

export const artifactsPage: Page = (root, ctx) => {
  const id = ctx.profile.id;
  let channel: ArtifactChannel = 'recommended';
  let busy = false;
  const buildSelect = h('select', { class: 'input' }, h('option', {}, 'Loading builds…')) as HTMLSelectElement;
  const buildField = field('Build', buildSelect);
  buildField.hidden = true;
  const info = h('div', { class: 'kv' });
  const log = h('pre', { class: 'log' });
  const updateBtn = button('Install update', () => update(), { kind: 'primary', icon: 'download' });
  const rollbackBtn = button('Roll back', () => rollback(), { kind: 'ghost', icon: 'rollback' });

  let versions: ArtifactVersions | undefined;
  const renderInfo = async () => {
    const hasPrevious = await call<boolean>('artifacts:has-previous', id);
    rollbackBtn.toggleAttribute('disabled', !hasPrevious || busy);
    updateBtn.toggleAttribute('disabled', busy);
    info.replaceChildren(
      h('span', {}, 'Installed build'),
      h('strong', {}, ctx.profile.artifactBuild ?? 'Unknown'),
      h('span', {}, 'Previous build'),
      h('strong', {}, hasPrevious ? (ctx.profile.previousArtifactBuild ?? 'Unknown') : 'None'),
      ...(versions ? [h('span', {}, 'Recommended'), h('strong', {}, versions.recommended), h('span', {}, 'Latest'), h('strong', {}, versions.latest)] : []),
    );
  };

  const setBusy = (value: boolean) => {
    busy = value;
    updateBtn.toggleAttribute('disabled', value);
    rollbackBtn.toggleAttribute('disabled', value);
  };

  async function update() {
    const build = channel === 'build' ? buildSelect.value : undefined;
    if (!(await confirmDialog('Update artifacts', `Install the ${channel === 'build' ? `build ${build}` : channel} artifacts? The current version is kept for rollback.`, 'Install'))) return;
    setBusy(true);
    log.textContent = '';
    const profile = await call<Profile>('artifacts:update', id, channel, build);
    if (profile) {
      ctx.profile = profile;
      toast('success', `Artifacts build ${profile.artifactBuild} installed`);
      await ctx.reloadProfiles();
    }
    setBusy(false);
    renderInfo();
  }

  async function rollback() {
    if (!(await confirmDialog('Roll back artifacts', 'Swap the installed artifacts with the previous version?', 'Roll back'))) return;
    setBusy(true);
    const profile = await call<Profile>('artifacts:rollback', id);
    if (profile) {
      ctx.profile = profile;
      toast('success', 'Artifacts rolled back');
      await ctx.reloadProfiles();
    }
    setBusy(false);
    renderInfo();
  }

  root.append(
    h(
      'div',
      { class: 'page-narrow' },
      h('section', { class: 'panel card' }, h('h3', {}, 'FXServer artifacts'), info),
      h(
        'section',
        { class: 'panel card' },
        h('h3', {}, 'Update'),
        field('Channel', segmented<ArtifactChannel>([['recommended', 'Recommended'], ['latest', 'Latest'], ['build', 'Specific build']], channel, (value) => ((channel = value), (buildField.hidden = value !== 'build')))),
        buildField,
        h('div', { class: 'actions' }, rollbackBtn, updateBtn),
        log,
      ),
    ),
  );
  renderInfo();
  call<ArtifactVersions>('artifacts:versions', ctx.profile.host?.os ?? 'windows').then((result) => {
    versions = result;
    if (!versions) return;
    buildSelect.replaceChildren(...versions.builds.map((b) => h('option', { value: b }, b)));
    renderInfo();
  });
  const off = api.on('artifacts:log', (text: string) => {
    log.textContent += text + '\n';
    log.scrollTop = log.scrollHeight;
  });
  return off;
};
