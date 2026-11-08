import { state } from './state.ts';
import { byId } from './util.ts';

/** Live indicator; it lives outside #app so its animation never restarts on re-render. */
export function updateLive() {
	const el = byId('live');
	el.hidden = state.view !== 'dash' || !state.cfg.locations.length;
	if (el.hidden) return;
	const age = state.fetchedAt ? Math.floor((Date.now() - state.fetchedAt) / 1000) : 0;
	el.classList.toggle('loading', state.loading);
	el.classList.toggle('error', !state.lastOk);
	byId('live-text').textContent = state.loading
		? 'обновляю…'
		: !state.lastOk
			? `нет связи · данные ${age} с назад`
			: !state.fetchedAt
				? 'загрузка…'
				: age < 3
					? 'данные обновлены'
					: `обновлено ${age} с назад`;
}
