import { ensureGtfs } from './gtfs.ts';
import { getLang, t } from './i18n.ts';
import type { StopCfg } from './plan.ts';
import { state } from './state.ts';
import { dayTimetable, hourTable, type PlannedDeparture, tallinnSec } from './trip.ts';
import { closeTrip, sheetRoot, sheetTurn } from './tripSheet.ts';
import { esc, routeSort } from './util.ts';

const pad = (n: number) => String(n).padStart(2, '0');

function dayName(now: Date): string {
	const s = new Intl.DateTimeFormat(getLang(), {
		weekday: 'long',
		timeZone: 'Europe/Tallinn',
	}).format(now);
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** hour rows from the current hour on; the minutes already gone in this hour are dimmed */
function table(deps: PlannedDeparture[], route: string | undefined, nowSec: number): string {
	const curHour = Math.floor(nowSec / 3600);
	const rows = hourTable(deps, route).filter((r) => r.hour >= curHour);
	if (!rows.length) return `<p class="muted">${t('tt.empty')}</p>`;
	const single = !!route;
	return rows
		.map((r) => {
			const mins = r.items
				.map((d) => {
					const m = pad(Math.floor((d.sec % 3600) / 60));
					const tag = single ? '' : `<sup class="tt-r ${d.mode}">${esc(d.route)}</sup>`;
					return `<span class="tt-m${d.sec < nowSec ? ' past' : ''}" title="${esc(d.headsign)}">${m}${tag}</span>`;
				})
				.join('');
			return `<div class="tt-row${r.hour >= 24 ? ' next' : ''}"><b class="tt-h">${pad(r.hour % 24)}</b><div class="tt-ms">${mins}</div></div>`;
		})
		.join('');
}

/** bottom sheet with today's timetable of a stop, by hour, with one chip per line */
export async function openTimetable(stop: StopCfg) {
	const root = sheetRoot();
	if (!root || !stop.code) return;
	closeTrip();
	const mine = sheetTurn();
	await ensureGtfs();
	if (!state.gtfs || mine !== sheetTurn()) return; // no timetable, or something else was opened meanwhile
	const now = new Date();
	const nowSec = tallinnSec(now);
	const deps = dayTimetable(state.gtfs, stop.code, now);
	const routes = [...new Set(deps.map((d) => d.route))].sort(routeSort);
	let route: string | undefined;
	root.hidden = false;
	root.innerHTML = `
    <div class="pk-bg" data-tp="close"></div>
    <div class="tp-sheet tt-sheet" role="dialog" aria-modal="true">
      <div class="tp-grab"></div>
      <div class="tp-head">
        <div class="tp-title"><b>${esc(stop.name)}</b><span class="muted">${esc(t('tt.sub', { day: dayName(now) }))}</span></div>
        <button class="icon" data-tp="close" aria-label="${t('trip.close')}">✕</button>
      </div>
      ${routes.length ? `<div class="goalbar tt-chips"><button type="button" class="gchip on" data-tt="">${t('card.all')}</button>${routes.map((r) => `<button type="button" class="gchip" data-tt="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
      <div class="tt-table">${table(deps, undefined, nowSec)}</div>
    </div>`;
	root.onclick = (e) => {
		const el = e.target as HTMLElement;
		if (el.closest('[data-tp=close]')) return closeTrip();
		const chip = el.closest<HTMLElement>('[data-tt]');
		if (!chip) return;
		route = chip.dataset.tt || undefined;
		root.querySelectorAll<HTMLElement>('.tt-chips .gchip').forEach((c) => {
			c.classList.toggle('on', (c.dataset.tt || undefined) === route);
		});
		const box = root.querySelector('.tt-table');
		if (box) box.innerHTML = table(deps, route, nowSec);
	};
}
