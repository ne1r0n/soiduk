import { namesUrl } from './datafiles.ts';
import { ensureGtfs } from './gtfs.ts';
import { t } from './i18n.ts';
import type { LocationCfg } from './plan.ts';
import { locationRows } from './rows.ts';
import { atStop, render, selectedGoal, state } from './state.ts';
import { pickRow, rowKey, saveWatch, WATCH_TTL_MS, watchNotice } from './watch.ts';

const TAG = 'soiduk-watch';
let notified = { key: '', shown: false, text: '' };

/**
 * The service worker lets a page show (and update) notifications, and keeps a copy of the app on the device
 * (public/sw.js). Under `npm run dev` it is registered as `sw.js?dev`, which switches the copy off.
 */
export function registerServiceWorker() {
	if (!('serviceWorker' in navigator)) return;
	const sw = navigator.serviceWorker;
	// A worker that has just taken over (first visit, or a new version of it) has not seen this page load:
	// tell it which files the page consists of, so that the next launch can do without the network.
	sw.addEventListener('controllerchange', () => {
		// the page itself, the names of the data files (their download may still be under way), what was loaded
		const urls = [location.href.split('#')[0], new URL(namesUrl(), location.href).href];
		for (const r of performance.getEntriesByType('resource')) {
			if (r.name.startsWith(location.origin)) urls.push(r.name);
		}
		sw.controller?.postMessage({ type: 'keep', urls });
	});
	sw.register(`${import.meta.env.BASE_URL}sw.js${import.meta.env.DEV ? '?dev' : ''}`).catch(
		() => {},
	);
}

async function closeNotice() {
	const reg = await navigator.serviceWorker?.getRegistration();
	for (const n of (await reg?.getNotifications({ tag: TAG })) ?? []) n.close();
}

export function stopWatch() {
	state.watch = null;
	saveWatch(null);
	notified = { key: '', shown: false, text: '' };
	closeNotice().catch(() => {});
	render();
}

/** start notifying about a departure; asking again for the pinned one stops */
export async function toggleWatch(loc: LocationCfg, pin: string) {
	const w = state.watch;
	if (w?.locId === loc.id && w.pin === pin) return stopWatch();
	if (!('Notification' in window) || !('serviceWorker' in navigator)) {
		alert(t('notify.unsupported'));
		return;
	}
	if (
		Notification.permission !== 'granted' &&
		(await Notification.requestPermission()) !== 'granted'
	) {
		alert(t('notify.denied'));
		return;
	}
	state.watch = {
		locId: loc.id,
		goalId: selectedGoal(loc)?.id ?? '',
		pin,
		until: Date.now() + WATCH_TTL_MS,
	};
	saveWatch(state.watch);
	notified = { key: '', shown: false, text: '' };
	render();
	updateWatch(true);
}

/** refreshes the notification of the pinned departure; ends it once the departure is gone */
export async function updateWatch(first = false) {
	const w = state.watch;
	if (!w) return;
	if (Date.now() > w.until) return stopWatch();
	const loc = state.cfg.locations.find((l) => l.id === w.locId);
	if (!loc) return stopWatch();
	const goal = loc.goals?.find((g) => g.id === w.goalId);
	const idx = state.gtfs;
	if (goal && !idx) {
		ensureGtfs();
		return;
	}
	if (!state.fetchedAt || Notification.permission !== 'granted') return;
	const elapsed = (Date.now() - state.fetchedAt) / 1000;
	const rows = locationRows(loc, goal, elapsed);
	const row = pickRow(rows, w.pin);
	if (!row) return stopWatch(); // departed, or no longer reachable
	const key = rowKey(row);
	const reg = await navigator.serviceWorker.ready;
	const visible = (await reg.getNotifications({ tag: TAG })).length > 0;
	// loud only the first time and when it is time to go; the user may have swiped it away – don't nag
	const loud = (row.leaveInSec < 60 && notified.key !== key) || first;
	if (!loud && !visible && notified.shown) return;
	if (row.leaveInSec < 60) notified.key = key;
	const n = watchNotice(row, loc.name, atStop(loc, row.siriId));
	const text = `${n.title}\n${n.body}`;
	// it is on the screen and says the same (the text counts in minutes): nothing to post
	if (!loud && visible && text === notified.text) return;
	notified.shown = true;
	notified.text = text;
	await reg.showNotification(n.title, {
		body: n.body,
		tag: TAG,
		requireInteraction: true,
		...(loud ? { renotify: true, vibrate: [200, 100, 200] } : { silent: true }),
	} as NotificationOptions);
}
