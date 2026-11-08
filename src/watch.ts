import { t } from './i18n.ts';
import { fmtClock, fmtMinutes, type Row } from './plan.ts';

/** A pinned departure: a notification that tells when to leave for that particular trip */
export interface Watch {
	locId: string;
	/** goal selected when pinned ('' = all departures); decides whether arrival is known */
	goalId: string;
	/** the pinned departure, see rowKey */
	pin: string;
	/** ms timestamp after which tracking stops by itself */
	until: number;
}

export const WATCH_TTL_MS = 90 * 60_000;
const KEY = 'soiduk.watch.v1';

export const rowKey = (r: Row) => `${r.siriId}|${r.dep.route}|${r.dep.scheduled}`;

/** the pinned departure, if it is still catchable */
export function pickRow(rows: Row[], pin: string): Row | undefined {
	return rows.find((r) => rowKey(r) === pin);
}

export function watchNotice(r: Row, locName: string): { title: string; body: string } {
	const walkSec = r.inSec - r.leaveInSec;
	const leaveAt = fmtClock(r.dep.expected - walkSec);
	const title =
		r.leaveInSec < 60
			? t('watch.now')
			: t('watch.at', { at: leaveAt, in: fmtMinutes(r.leaveInSec) });
	// arrival is only known when a goal was selected
	const to = ` → ${r.arrive ? r.arrive.stopName : r.dep.dest}`;
	const arr = r.arrive ? ` · ${t('watch.arr')} ${fmtClock(r.arrive.sec)}` : '';
	const v = r.arrive?.via;
	const change = !v
		? ''
		: v.walk
			? `\n⇄ ${v.stopName} · 🚶 ${Math.max(1, Math.round(v.walkSec / 60))} ${t('unit.min')}`
			: `\n⇄ ${v.stopName} → ${v.route} ${fmtClock(v.depSec)}`;
	return {
		title,
		body: `${r.dep.route}${to} · ${t('watch.dep')} ${fmtClock(r.dep.expected)}${arr}${change}\n${locName}`,
	};
}

export function loadWatch(): Watch | null {
	try {
		const w = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Watch | null;
		return w?.pin && w.until > Date.now() ? w : null;
	} catch {
		return null;
	}
}

export function saveWatch(w: Watch | null) {
	if (w) localStorage.setItem(KEY, JSON.stringify(w));
	else localStorage.removeItem(KEY);
}
