import { langChosen, t } from './i18n.ts';
import { state } from './state.ts';
import { inDemo } from './store.ts';
import { byId } from './util.ts';

/** Live indicator; it lives outside #app so its animation never restarts on re-render. */
export function updateLive() {
	const el = byId('live');
	el.hidden = state.view !== 'dash' || !state.cfg.locations.length || !langChosen();
	if (el.hidden) return;
	// the settings would edit the example, which is not saved
	el.querySelector<HTMLElement>('[data-act=edit]')!.hidden = inDemo();
	const age = state.fetchedAt ? Math.floor((Date.now() - state.fetchedAt) / 1000) : 0;
	el.classList.toggle('loading', state.loading);
	el.classList.toggle('error', !state.lastOk);
	byId('live-text').textContent = state.loading
		? t('live.updating')
		: !state.lastOk
			? t('live.offline', { age })
			: !state.fetchedAt
				? t('live.loading')
				: age < 3
					? t('live.fresh')
					: t('live.age', { age });
}
