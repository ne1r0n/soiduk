import type { Mode } from './api.ts';
import { ensureGeo } from './geo.ts';
import { ensureGtfs, stopInfo } from './gtfs.ts';
import { t } from './i18n.ts';
import {
	buildRows,
	fmtClock,
	fmtMinutes,
	type GoalCfg,
	type LocationCfg,
	type Row,
	type StopCfg,
} from './plan.ts';
import { XFER } from './rows.ts';
import { selectedGoal, state } from './state.ts';
import type { GtfsIndex } from './trip.ts';
import { esc } from './util.ts';
import { rowKey } from './watch.ts';

const MAX_EXTRA_ROWS = 3;
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
	return `<span class="via" title="${t('card.change')}">⇄ ${esc(v.stopName)}${walk} → <span class="badge mini ${modeClass[v.mode]}">${esc(v.route)}</span> ${fmtClock(v.depSec)}</span>`;
}

/** "выйти через 5 мин" / "выйти сейчас" */
function leaveText(sec: number): string {
	return sec < 60 ? t('leave.now') : t('leave.in', { t: fmtMinutes(sec) });
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
): { html: string; empty: boolean } {
	const walk = stop.walkMin ?? loc.walkMin;
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
	const head = `<header>
      <div class="stop-title"><h2>${esc(stop.name)}</h2>${dir ? `<span class="dirs">${dir}</span>` : ''}</div>
      <div class="head-right"><span class="walk">🚶 ${walk} ${t('unit.min')}${stale}</span><span class="dirs${isPlanned ? ' plan' : ''}" ${isPlanned ? `title="${t('card.planTitle')}"` : ''}>${isPlanned ? t('card.plan') : t('card.dep')}</span></div></header>`;
	const shell = (inner: string, cls = '') => ({
		html: `<section class="card ${cls}">${head}${inner}</section>`,
		empty: false,
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

	const lvl = urgency(rows[0].leaveInSec);
	const pinned = state.watch?.pin;
	const list = rows
		.slice(0, 1 + MAX_EXTRA_ROWS)
		.map(
			(r) => `
    <li data-act="trip" data-key="${rowKey(r)}" class="pinnable${r.arrive?.via ? ' xfer' : ''}">
      ${badge(r)}
      <span class="dest"><span class="dn">${esc(r.arrive ? r.arrive.stopName : r.dep.dest)}</span>${r.arrive ? `<span class="arr" title="${t('card.arrival')}">(${fmtClock(r.arrive.sec)})</span>` : ''}${pinned === rowKey(r) ? `<span class="pin" title="${t('card.pinned')}">🔔</span>` : ''}</span>
      <span class="when">${fmtClock(r.dep.expected)}${delayTag(r.delaySec)}</span>
      <span class="in">${leaveText(r.leaveInSec)}</span>
      ${r.arrive?.via ? viaLine(r.arrive.via) : ''}
    </li>`,
		)
		.join('');
	return shell(`<ul class="rows">${list}</ul>`, lvl);
}

/** A location groups the cards of its stops and owns the goal selector */
function locationSection(loc: LocationCfg, elapsed: number): string {
	const goals = loc.goals ?? [];
	const goal = selectedGoal(loc);
	const bar = goals.length
		? `<div class="goalbar">
      <button class="gchip ${goal ? '' : 'on'}" data-act="select-goal" data-gid="">${t('card.all')}</button>
      ${goals.map((g) => `<button class="gchip ${goal?.id === g.id ? 'on' : ''}" data-act="select-goal" data-gid="${g.id}">→ ${esc(g.name)}</button>`).join('')}
    </div>`
		: '';
	const head = `<div class="loc-head"><h3>${esc(loc.name)}</h3>${bar}</div>`;
	const wrap = (inner: string) =>
		`<section class="loc" data-loc="${loc.id}">${head}${inner}</section>`;
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
	return wrap(hint + cards.map((c) => c.html).join(''));
}

export function dashboard(): string {
	const elapsed = state.fetchedAt ? (Date.now() - state.fetchedAt) / 1000 : 0;
	const body = state.cfg.locations.map((l) => locationSection(l, elapsed)).join('');
	return `
    <main>${body}</main>`;
}
