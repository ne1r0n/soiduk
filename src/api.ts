export type Mode = 'bus' | 'trol' | 'tram' | 'other';

export interface Departure {
	mode: Mode;
	route: string;
	/** seconds from Tallinn midnight */
	expected: number;
	scheduled: number;
	dest: string;
}

export interface StopDepartures {
	/** server "now" in seconds from Tallinn midnight */
	now: number;
	items: Departure[];
}

const BASE = 'https://transport.tallinn.ee/siri-stop-departures.php';

/**
 * Stops asked for in one request. The feed takes up to 15 (for more it answers with nothing at all) and
 * works through them one by one, ~50 ms each, so a handful per request keeps both the number of requests
 * and the wait low.
 */
export const MAX_STOPS_PER_REQUEST = 5;

/** Splits a list into groups of at most `max`, as even as possible (6 → 3 + 3 rather than 5 + 1). */
export function batches<T>(items: readonly T[], max = MAX_STOPS_PER_REQUEST): T[][] {
	const n = Math.ceil(items.length / max);
	const out: T[][] = [];
	for (let i = 0; i < n; i++) {
		out.push(
			items.slice(Math.round((i * items.length) / n), Math.round(((i + 1) * items.length) / n)),
		);
	}
	return out;
}

function toMode(t: string): Mode {
	switch (t.trim().toLowerCase()) {
		case 'bus':
			return 'bus';
		case 'trol':
			return 'trol';
		case 'tram':
			return 'tram';
		default:
			return 'other';
	}
}

/**
 * Response format – one block per stop that has departures:
 *   Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,<now>,version...
 *   stop,<siriId>
 *   bus,33,55048,54954,Kopli,26,Z
 *   stop,<siriId>
 *   …
 * `rest` holds departures that came before any `stop` line.
 */
export function parseStops(text: string): {
	now: number;
	byStop: Map<number, Departure[]>;
	rest: Departure[];
} {
	const lines = text.split(/\r?\n/).filter(Boolean);
	const now = Number((lines[0] ?? '').split(',')[4]);
	if (!Number.isFinite(now)) throw new Error('Unexpected departures format');
	const byStop = new Map<number, Departure[]>();
	const rest: Departure[] = [];
	let cur = rest;
	for (const line of lines.slice(1)) {
		const f = line.split(',');
		if (f[0] === 'stop') {
			const id = Number(f[1]);
			cur = byStop.get(id) ?? [];
			byStop.set(id, cur);
			continue;
		}
		if (f.length < 5) continue;
		const expected = Number(f[2]);
		const scheduled = Number(f[3]);
		if (!Number.isFinite(expected) || !Number.isFinite(scheduled)) continue;
		cur.push({ mode: toMode(f[0]), route: f[1], expected, scheduled, dest: f[4] });
	}
	return { now, byStop, rest };
}

/**
 * Live departures of several stops in one request (see MAX_STOPS_PER_REQUEST). Every stop asked for is in
 * the result: one the feed has nothing for gets an empty list.
 */
async function requestDepartures(
	siriIds: readonly number[],
	signal?: AbortSignal,
): Promise<Map<number, StopDepartures>> {
	const controller = new AbortController();
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(
		() => controller.abort(new Error('Departures request timed out')),
		10_000,
	);
	let text: string;
	try {
		const res = await fetch(`${BASE}?stopid=${siriIds.join(',')}`, {
			signal: controller.signal,
			cache: 'no-store',
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		text = await res.text();
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
	const { now, byStop, rest } = parseStops(text);
	return new Map(
		siriIds.map((id) => [
			id,
			// a lone stop also owns the lines that came without a `stop` header
			{ now, items: byStop.get(id) ?? (siriIds.length === 1 ? rest : []) },
		]),
	);
}

// Both the dashboard and the picker use this pool. Reuse an in-flight stop even when the other caller
// asks for a different group; a very recent answer also covers quick close/open and selection gestures.
const pending = new Map<number, Promise<StopDepartures>>();
const recent = new Map<number, { at: number; data: StopDepartures }>();
const REUSE_MS = 2000;
const MAX_CONCURRENT = 3;
let active = 0;
const waiting: (() => void)[] = [];

async function pooledRequest(ids: number[]): Promise<Map<number, StopDepartures>> {
	if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
	else active++;
	try {
		return await requestDepartures(ids);
	} finally {
		const next = waiting.shift();
		if (next)
			next(); // pass the occupied slot straight to the next request
		else active--;
	}
}

/** Shared, bounded requests; an explicitly cancellable caller owns its request independently. */
export async function fetchDepartures(
	siriIds: readonly number[],
	signal?: AbortSignal,
): Promise<Map<number, StopDepartures>> {
	if (signal) return requestDepartures(siriIds, signal);
	const now = Date.now();
	// `abs`: a clock that was set back must not keep an old answer alive
	for (const [id, item] of recent) if (Math.abs(now - item.at) >= REUSE_MS) recent.delete(id);
	const ids = [...new Set(siriIds)];
	const ready = new Map<number, StopDepartures>();
	for (const id of ids) {
		const item = recent.get(id);
		if (item)
			ready.set(id, { now: item.data.now + (now - item.at) / 1000, items: item.data.items });
	}
	const missing = ids.filter((id) => !pending.has(id) && !recent.has(id));
	for (const group of batches(missing)) {
		const result = pooledRequest(group);
		for (const id of group) {
			const item = result.then((data) => {
				const d = data.get(id)!;
				recent.set(id, { at: Date.now(), data: d });
				return d;
			});
			pending.set(id, item);
			// Attach rejection handlers even when another stop in a group has already failed.
			item.then(
				() => pending.delete(id),
				() => pending.delete(id),
			);
		}
	}
	return new Map(
		await Promise.all(
			ids.map(async (id) => [id, ready.get(id) ?? (await pending.get(id)!)] as const),
		),
	);
}

/** Forget completed responses (also useful when replacing fetch in tests). */
export function clearDepartureCache(): void {
	recent.clear();
}
