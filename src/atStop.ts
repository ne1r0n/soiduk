/**
 * «At the stop»: a stop card switched to show every upcoming departure, without the walking time – for when
 * you are already on the way or standing at the stop. It ends by itself, so that the next time the app is
 * opened at home it tells you when to leave again.
 *
 * Kept per stop: `${locId}:${siriId}` → ms timestamp after which the walking time counts again.
 */
export type AtStop = Record<string, number>;

export const AT_STOP_TTL_MS = 30 * 60_000;
const KEY = 'soiduk.atstop.v1';

export const isAtStop = (m: AtStop, key: string, now = Date.now()): boolean => (m[key] ?? 0) > now;

/** switches a stop over, or back; entries that have run out are dropped along the way */
export function toggleAtStop(m: AtStop, key: string, now = Date.now()): AtStop {
	const live = Object.fromEntries(Object.entries(m).filter(([, until]) => until > now));
	if (key in live) delete live[key];
	else live[key] = now + AT_STOP_TTL_MS;
	return live;
}

export function loadAtStop(): AtStop {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		if (!raw || typeof raw !== 'object') return {};
		return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number'));
	} catch {
		return {};
	}
}

export function saveAtStop(m: AtStop): void {
	localStorage.setItem(KEY, JSON.stringify(m));
}
