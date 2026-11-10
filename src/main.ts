import './style.css';
import { bindActions } from './actions.ts';
import { offerImport } from './backup.ts';
import { backfill, refresh, refreshIfDue, setAfterRefresh } from './data.ts';
import { ensureGtfs } from './gtfs.ts';
import { initLang, t } from './i18n.ts';
import { updateLive } from './live.ts';
import { registerServiceWorker, updateWatch } from './notify.ts';
import { initPullToRefresh } from './pull.ts';
import { renderApp, tickApp } from './render.ts';
import { decodeConfig } from './share.ts';
import { render, setRenderer, state } from './state.ts';
import { initTheme } from './theme.ts';
import { byId } from './util.ts';

const REFRESH_MS = 20_000;

initTheme();
initPullToRefresh();
initLang();
setRenderer(renderApp);
setAfterRefresh(updateWatch);
bindActions(byId('app'), byId('live'));
registerServiceWorker();

// ---------- loop ----------
/** the countdowns: the dashboard and the status next to the gear */
function tick() {
	tickApp();
	updateLive();
}
setInterval(() => {
	if (!document.hidden) tick(); // nobody is looking at a hidden page
}, 1000);
setInterval(() => {
	if (!document.hidden || state.watch) refresh();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
	if (document.hidden) return;
	render(); // state may have changed while only a pinned stop was refreshed in the background
	updateLive();
	refreshIfDue();
});

window.addEventListener('online', () => refresh());

backfill();

// ask the browser not to evict our settings under storage pressure
navigator.storage?.persist?.().catch(() => {});

// opened via a shared link: #cfg=<token>
const shared = new URLSearchParams(location.hash.slice(1)).get('cfg');
if (shared) {
	history.replaceState(null, '', location.pathname + location.search);
	decodeConfig(shared)
		.then((c) => offerImport(c, t('msg.fromLink')))
		.catch((err) => alert(t('msg.linkBroken', { err: String(err) })));
}

render();
updateLive();
refresh();
if (state.watch) ensureGtfs();
