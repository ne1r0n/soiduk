import type { Mode } from './api.ts';
import { ensureGeo } from './geo.ts';
import { ensureGtfs, stopInfo } from './gtfs.ts';
import { t } from './i18n.ts';
import {
	buildRows,
	fmtClock,
	type GoalCfg,
	type LocationCfg,
	leaveText,
	type Row,
	type StopCfg,
} from './plan.ts';
import { XFER } from './rows.ts';
import { atStop, selectedGoal, state, walkMinOf } from './state.ts';
import { inDemo } from './store.ts';
import type { GtfsIndex } from './trip.ts';
import { esc } from './util.ts';
import { rowKey } from './watch.ts';

const MAX_EXTRA_ROWS = 3;

// The clock. Nothing in the HTML of the dashboard changes as time passes: a countdown, and a card (its colour
// says how soon to leave), is only marked with `data-t`, and `times` holds – in the order of the page – the
// moment each of them counts down to. `tickDashboard` writes the texts and the colours from that: once a
// second, and right after the HTML is put on the page. So fresh data that says the same replaces nothing.
let times: number[] = [];
let renderedAt = 0;
/** when the rows themselves go out of date: a trip can no longer be caught, «at the stop» runs out */
let rebuildAt = Infinity;
const leaveAt = (r: Row) => renderedAt + r.leaveInSec * 1000;
const LEVELS = ['now', 'soon', 'ok'];

/** Writes the countdowns and the colours of the cards. @returns true when the rows have to be built anew. */
export function tickDashboard(root: HTMLElement, now = Date.now()): boolean {
	root.querySelectorAll<HTMLElement>('[data-t]').forEach((el, i) => {
		const sec = (times[i] - now) / 1000;
		const kind = el.dataset.t;
		if (kind === 'card') {
			const level = urgency(sec);
			for (const name of LEVELS) el.classList.toggle(name, name === level);
		} else {
			const text = leaveText(sec, kind === 'stop');
			if (el.textContent !== text) el.textContent = text;
		}
	});
	return now >= rebuildAt;
}

const modeClass: Record<Mode, string> = { bus: 'bus', trol: 'trol', tram: 'tram', other: 'bus' };

function urgency(leaveSec: number): string {
	if (leaveSec < 60) return 'now';
	if (leaveSec < 5 * 60) return 'soon';
	return 'ok';
}

function badge(r: Row) {
	return `<span class="badge ${modeClass[r.dep.mode]}">${esc(r.dep.route)}</span>`;
}

function delayTag(sec: number) {
	const m = Math.round(sec / 60);
	if (m >= 1) return `<span class="delay late">+${m}</span>`;
	if (m <= -1) return `<span class="delay early">${m}</span>`;
	return '';
}

/** second line of a trip with a change: «⇄ Kopli · 🚶 2 мин → [33] 14:05» */
function viaLine(v: NonNullable<NonNullable<Row['arrive']>['via']>): string {
	const walk = v.walkSec ? ` · 🚶 ${Math.max(1, Math.round(v.walkSec / 60))} ${t('unit.min')}` : '';
	if (v.walk)
		return `<span class="via" title="${t('card.change')}">⇄ ${esc(v.stopName)}${walk}</span>`;
	return `<span class="via" title="${t('card.change')}">⇄ ${esc(v.stopName)}${walk} → <span class="badge mini ${modeClass[v.mode]}">${esc(v.route)}</span> ${fmtClock(v.depSec)}</span>`;
}

function stopDirection(stop: StopCfg): string {
	if (stop.label) return esc(stop.label);
	const d = stopInfo(stop).dests;
	return d.length ? `→ ${d.slice(0, 2).map(esc).join(' · ')}` : '';
}

/** One card = one stop (walking time differs per stop, so schedules must not be mixed) */
function stopCard(
	loc: LocationCfg,
	stop: StopCfg,
	goal: GoalCfg | undefined,
	idx: GtfsIndex | null,
	elapsed: number,
	transfers = false,
): { html: string; empty: boolean; times: number[] } {
	// already on the way or at the stop: the walk counts as 0 min, so every departure that has not left yet
	// is shown, counted down to the departure itself
	const here = atStop(loc, stop.siriId);
	const walk = walkMinOf(loc, stop);
	const one: LocationCfg = {
		id: `${loc.id}:${stop.siriId}`,
		name: loc.name,
		walkMin: walk,
		stops: [stop],
		goals: loc.goals,
	};
	const dir = stopDirection(stop);
	const stale = state.failed.has(stop.siriId)
		? ` <span class="stale" title="${t('card.stale')}">⚠</span>`
		: '';
	const isPlanned = state.planned.has(stop.siriId);
	const right = `<span class="walk">🚶 ${walk} ${t('unit.min')}${stale}</span><span class="dirs${isPlanned ? ' plan' : ''}" ${isPlanned ? `title="${t('card.planTitle')}"` : ''}>${isPlanned ? t('card.plan') : t('card.dep')}</span>`;
	// the walking time is a switch (nothing to switch when the stop is at the door)
	const headRight =
		walk > 0 || here
			? `<button type="button" class="head-right at-toggle${here ? ' on' : ''}" data-act="at-stop" data-stop="${stop.siriId}" aria-pressed="${here}" title="${t(here ? 'card.atStopOff' : 'card.atStopOn')}">${right}</button>`
			: `<div class="head-right">${right}</div>`;
	const head = `<header>
      <div class="stop-title"${stop.code ? ` data-act="timetable" data-stop="${stop.siriId}" role="button" aria-label="${t('tt.open')}"` : ''}><h2>${esc(stop.name)}</h2>${dir ? `<span class="dirs">${dir}</span>` : ''}</div>
      ${headRight}</header>`;
	/** `clock`: what the card and its rows count down to, see `times` */
	const shell = (inner: string, clock: number[] = []) => ({
		html: `<section class="card"${clock.length ? ' data-t="card"' : ''}>${head}${inner}</section>`,
		empty: false,
		times: clock,
	});
	if (!state.data.has(stop.siriId)) {
		return shell(
			`<p class="muted">${state.loading || !state.fetchedAt ? t('card.loading') : t('card.nodata')}</p>`,
		);
	}

	const rows = buildRows(
		one,
		state.data,
		elapsed,
		30,
		goal && idx ? { goal, idx, transfers: transfers ? XFER : undefined } : undefined,
	);
	if (!rows.length) {
		const r = shell(
			`<p class="muted">${goal ? t('card.noGoal', { goal: esc(goal.name) }) : t('card.noDeps')}</p>`,
		);
		return { ...r, empty: true };
	}

	// Include all rows: even a hidden departure can affect the direct/transfer choice when it expires.
	for (const row of rows) rebuildAt = Math.min(rebuildAt, leaveAt(row) + 30_001);
	const pinned = state.watch?.pin;
	const shown = rows.slice(0, 1 + MAX_EXTRA_ROWS);
	const list = shown
		.map(
			(r) => `
    <li data-act="trip" data-key="${rowKey(r)}" class="pinnable${r.arrive?.via ? ' xfer' : ''}">
      ${badge(r)}
      <span class="dest"><span class="dn">${esc(r.arrive ? r.arrive.stopName : r.dep.dest)}</span>${r.arrive ? `<span class="arr" title="${t('card.arrival')}">(${fmtClock(r.arrive.sec)})</span>` : ''}${pinned === rowKey(r) ? `<span class="pin" title="${t('card.pinned')}">🔔</span>` : ''}</span>
      <span class="when">${fmtClock(r.dep.expected)}${delayTag(r.delaySec)}</span>
      <span class="in" data-t="${here ? 'stop' : 'walk'}"></span>
      ${r.arrive?.via ? viaLine(r.arrive.via) : ''}
    </li>`,
		)
		.join('');
	// the colour of the card follows its first row; then the countdown of each row
	return shell(`<ul class="rows">${list}</ul>`, [leaveAt(rows[0]), ...shown.map(leaveAt)]);
}

/** A location groups the cards of its stops and owns the goal selector */
function locationSection(loc: LocationCfg, elapsed: number): { html: string; times: number[] } {
	const goals = loc.goals ?? [];
	const goal = selectedGoal(loc);
	const bar = goals.length
		? `<div class="goalbar">
      <button class="gchip ${goal ? '' : 'on'}" data-act="select-goal" data-gid="">${t('card.all')}</button>
      ${goals.map((g) => `<button class="gchip ${goal?.id === g.id ? 'on' : ''}" data-act="select-goal" data-gid="${g.id}">→ ${esc(g.name)}</button>`).join('')}
    </div>`
		: '';
	const head = `<div class="loc-head"><h3>${esc(loc.name)}</h3>${bar}</div>`;
	const wrap = (inner: string, clock: number[] = []) => ({
		html: `<section class="loc" data-loc="${loc.id}">${head}${inner}</section>`,
		times: clock,
	});
	const note = (msg: string) => wrap(`<section class="card"><p class="muted">${msg}</p></section>`);
	if (!loc.stops.length) return note(t('card.noStops'));

	let idx: GtfsIndex | null = null;
	if (goal) {
		ensureGtfs();
		if (!state.gtfs) {
			return note(state.gtfsState === 'error' ? t('card.gtfsError') : t('card.gtfsLoading'));
		}
		idx = state.gtfs;
	}
	let cards = loc.stops.map((s) => stopCard(loc, s, goal, idx, elapsed));
	let withChange = false;
	if (goal && !cards.some((c) => !c.empty)) {
		// no stop has a direct route: look for connections with one change (needs stop coordinates)
		ensureGeo();
		const alt = loc.stops.map((s) => stopCard(loc, s, goal, idx, elapsed, true));
		if (alt.some((c) => !c.empty)) {
			cards = alt;
			withChange = true;
		}
	}
	// towards a goal, hide stops on the wrong side of the road – unless that leaves nothing
	if (goal && cards.some((c) => !c.empty)) cards = cards.filter((c) => !c.empty);
	const hint = withChange ? `<p class="hint muted xfer-note">${t('card.xfer')}</p>` : '';
	const addGoal =
		goals.length || inDemo()
			? ''
			: `<div class="ob-goal"><p class="muted">${t('card.goalHint')}</p><button type="button" class="btn ghost" data-act="edit">${t('card.addGoal')}</button></div>`;
	return wrap(
		hint + cards.map((c) => c.html).join('') + addGoal,
		cards.flatMap((c) => c.times),
	);
}

export function dashboard(): string {
	renderedAt = Date.now();
	rebuildAt = Infinity;
	for (const until of Object.values(state.atStop)) {
		if (until > renderedAt) rebuildAt = Math.min(rebuildAt, until);
	}
	const elapsed = state.fetchedAt ? (renderedAt - state.fetchedAt) / 1000 : 0;
	const places = state.cfg.locations.map((l) => locationSection(l, elapsed));
	times = places.flatMap((p) => p.times);
	const bar = inDemo()
		? `<div class="demo-bar"><span>${t('demo.bar')}</span><button type="button" class="btn primary" data-act="wiz-leave-demo">${t('demo.own')}</button></div>`
		: '';
	return `
    <main>${bar}${places.map((p) => p.html).join('')}</main>`;
}
