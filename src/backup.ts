import { backfill, refresh } from './data.ts';
import { t } from './i18n.ts';
import { updateLive } from './live.ts';
import { persist, render, state } from './state.ts';
import { type Config, savePrev, saveSelection } from './store.ts';

/** replaces the settings; the old ones stay available through «Вернуть предыдущие» */
export function replaceConfig(next: Config) {
	if (state.cfg.locations.length) savePrev(state.cfg); // nothing worth undoing when starting from empty
	state.cfg = next;
	state.selection = {};
	saveSelection(state.selection);
	persist();
	backfill();
	refresh();
}

function describe(c: Config): string {
	const stops = c.locations.reduce((n, l) => n + l.stops.length, 0);
	const goals = c.locations.reduce((n, l) => n + (l.goals?.length ?? 0), 0);
	return t('msg.describe', { l: c.locations.length, s: stops, g: goals });
}

export function offerImport(next: Config, source: string) {
	const have = state.cfg.locations.length ? t('msg.importHave', { d: describe(state.cfg) }) : '';
	if (confirm(t('msg.import', { source, d: describe(next), have }))) {
		replaceConfig(next);
		state.view = 'dash';
		render();
		updateLive();
	}
}
