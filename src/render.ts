import { dashboard } from './dashboard.ts';
import { editor } from './editor.ts';
import { langChosen } from './i18n.ts';
import { state } from './state.ts';
import { byId } from './util.ts';
import { welcome } from './welcome.ts';

/** Redraws #app from the state. */
export function renderApp() {
	const active = document.activeElement as HTMLElement | null;
	// don't clobber text inputs while typing: editor re-renders only on structural changes
	if (
		state.view === 'edit' &&
		active &&
		active.tagName === 'INPUT' &&
		!(active as HTMLInputElement).dataset.rerender
	)
		return;
	const scroll = window.scrollY;
	byId('app').innerHTML = !langChosen()
		? welcome()
		: state.view === 'dash'
			? dashboard()
			: editor();
	window.scrollTo(0, scroll);
}
