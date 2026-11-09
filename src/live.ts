import { langChosen, t } from './i18n.ts';
import { state } from './state.ts';
import { inDemo } from './store.ts';
import { byId } from './util.ts';

const STALE_SEC = 60;

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
	// the dot says «all fine»; words appear only when something is off
	byId('live-text').textContent = state.loading
		? ''
		: !state.lastOk
			? t('live.offline', { age })
			: age >= STALE_SEC
				? t('live.age', { age })
				: '';
}
