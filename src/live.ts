import { langChosen, t } from './i18n.ts';
import { state } from './state.ts';
import { inDemo } from './store.ts';
import { byId } from './util.ts';

const STALE_SEC = 60;
const MIN_SHOW_MS = 900;
let shownAt = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** A short blink after the place title while data is being fetched; stays long enough to be seen. */
function blink(on: boolean) {
	const cl = document.body.classList;
	if (on) {
		clearTimeout(hideTimer);
		if (!cl.contains('refreshing')) shownAt = Date.now();
		cl.add('refreshing');
	} else if (cl.contains('refreshing')) {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(
			() => cl.remove('refreshing'),
			Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt)),
		);
	}
}

/**
 * Status next to the gear (outside #app, so it survives re-renders). Silent while all is well: a refresh
 * shows as a blink after the place title, and a message appears only when something is off.
 */
export function updateLive() {
	blink(state.loading);
	const el = byId('live');
	el.hidden = state.view !== 'dash' || !state.cfg.locations.length || !langChosen();
	if (el.hidden) return;
	// the settings would edit the example, which is not saved
	el.querySelector<HTMLElement>('[data-act=edit]')!.hidden = inDemo();
	const age = state.fetchedAt ? Math.floor((Date.now() - state.fetchedAt) / 1000) : 0;
	const msg = byId('live-text');
	const bad = !state.lastOk;
	const text = state.loading
		? ''
		: bad
			? t('live.offline', { age })
			: age >= STALE_SEC
				? t('live.age', { age })
				: '';
	msg.textContent = text;
	msg.hidden = !text;
	msg.classList.toggle('error', bad);
}
