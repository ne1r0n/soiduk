import { dashboard, tickDashboard } from './dashboard.ts';
import { editor } from './editor.ts';
import { langChosen } from './i18n.ts';
import { onboarding } from './onboard.ts';
import { state } from './state.ts';
import { byId } from './util.ts';
import { welcome } from './welcome.ts';

/** the HTML #app was last given */
let shown: string | null = null;

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
	const dash = langChosen() && state.view === 'dash';
	const html = !langChosen()
		? welcome()
		: state.view === 'start'
			? onboarding()
			: dash
				? dashboard()
				: editor();
	// The dashboard has no inputs, and nothing in its HTML changes as time passes (the countdowns are written
	// by tickDashboard), so the same HTML means the same DOM: leave it alone – no layout, no repaint, taps are
	// not interrupted. Fresh data that says the same as before replaces nothing.
	if (html !== shown || state.view !== 'dash') {
		shown = html;
		const scroll = window.scrollY;
		byId('app').innerHTML = html;
		window.scrollTo(0, scroll);
	}
	if (dash) tickDashboard(byId('app'));
}

/** The clock: the countdowns are rewritten; the dashboard is built anew only when its rows are out of date. */
export function tickApp() {
	if (state.view !== 'dash' || !langChosen()) return;
	if (tickDashboard(byId('app'))) renderApp();
}
