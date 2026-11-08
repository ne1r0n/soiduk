import { ensureGtfs } from './gtfs.ts';
import { t } from './i18n.ts';
import type { LocationCfg } from './plan.ts';
import { locationRows } from './rows.ts';
import { render, selectedGoal, state } from './state.ts';
import { pickRow, rowKey, saveWatch, WATCH_TTL_MS, watchNotice } from './watch.ts';

const TAG = 'soiduk-watch';
let notified = { key: '', shown: false };

/** the service worker is what lets a page show (and update) notifications */
export function registerServiceWorker() {
	if ('serviceWorker' in navigator)
		navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

async function closeNotice() {
	const reg = await navigator.serviceWorker?.getRegistration();
	for (const n of (await reg?.getNotifications({ tag: TAG })) ?? []) n.close();
}

export function stopWatch() {
	state.watch = null;
	saveWatch(null);
	notified = { key: '', shown: false };
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
	notified = { key: '', shown: false };
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
	notified.shown = true;
	const n = watchNotice(row, loc.name);
	await reg.showNotification(n.title, {
		body: n.body,
		tag: TAG,
		requireInteraction: true,
		...(loud ? { renotify: true, vibrate: [200, 100, 200] } : { silent: true }),
	} as NotificationOptions);
}
