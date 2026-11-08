import L from 'leaflet';
import { ensureGeo, nearStops, stopNameByCode, stopPos } from './geo.ts';
import { ensureGtfs } from './gtfs.ts';
import { plural, t } from './i18n.ts';
import { type Journey, journeyOf } from './journey.ts';
import { toggleWatch } from './notify.ts';
import { fmtClock, fmtMinutes, type LocationCfg, type Row } from './plan.ts';
import { locationRows } from './rows.ts';
import { loadShapes, roadBetween } from './shapes.ts';
import { selectedGoal, state } from './state.ts';
import { loadStops } from './stops.ts';
import { esc } from './util.ts';
import { rowKey } from './watch.ts';

let root: HTMLElement | null = null;
let map: L.Map | null = null;

export function closeTrip() {
	map?.remove();
	map = null;
	if (root) {
		root.hidden = true;
		root.innerHTML = '';
	}
}

export const tripOpen = () => map !== null || (root !== null && !root.hidden);

const cssVar = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#38bdf8';

function badge(route: string, mode: string) {
	const cls = mode === 'trol' || mode === 'tram' ? mode : 'bus';
	return `<span class="badge mini ${cls}">${esc(route)}</span>`;
}

/** the few lines that say what to do: where to board, where to change, where you arrive */
function steps(row: Row, j: Journey | null): string {
	const line = (time: string, name: string, extra = '') =>
		`<li><time>${time}</time><span class="tp-name">${esc(name)}</span>${extra}</li>`;
	const count = (l?: { i: number; j: number }) => {
		const n = l ? l.j - l.i : 0;
		return n > 0 ? `<span class="muted tp-n">${n} ${plural('w.stops', n)}</span>` : '';
	};
	const out = [
		line(
			fmtClock(row.dep.expected),
			row.stopName,
			count(j?.legs[0]) + badge(row.dep.route, row.dep.mode),
		),
	];
	const v = row.arrive?.via;
	if (v && j) {
		const walk = j.walkSec
			? `<span class="muted">🚶 ${Math.max(1, Math.round(j.walkSec / 60))} ${t('unit.min')}</span>`
			: '';
		out.push(
			line(fmtClock(v.depSec), v.stopName, `${walk}${count(j.legs[1])}${badge(v.route, v.mode)}`),
		);
	}
	if (row.arrive) out.push(line(fmtClock(row.arrive.sec), row.arrive.stopName));
	return `<ol class="tp-steps">${out.join('')}</ol>`;
}

function draw(
	el: HTMLElement,
	j: Journey,
	shapes: Awaited<ReturnType<typeof loadShapes>>,
): { m: L.Map; fit: () => void } {
	const m = L.map(el, { zoomControl: false, attributionControl: true });
	L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
		maxZoom: 19,
		attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
	}).addTo(m);
	const pts: L.LatLngExpression[] = [];
	const at = (code: string) => {
		const p = stopPos(code);
		return p ? ([p.la, p.lo] as [number, number]) : undefined;
	};
	const dot = (
		code: string,
		color: string,
		big: boolean,
		side: 'top' | 'left' | 'right' = 'top',
		label = true,
	) => {
		const p = at(code);
		if (!p) return;
		const mk = L.circleMarker(p, {
			radius: big ? 9 : 6,
			color,
			fillColor: big ? color : cssVar('--bg'),
			fillOpacity: 1,
			weight: 3,
		}).addTo(m);
		if (label)
			mk.bindTooltip(esc(stopNameByCode(code)), {
				permanent: true,
				direction: side,
				offset: side === 'top' ? [0, -8] : [side === 'left' ? -8 : 8, 0],
				className: 'pk-tip',
			});
	};
	let prevEnd: [number, number] | undefined;
	j.legs.forEach((leg) => {
		// the real road when the geometry is there, otherwise straight lines between stops
		// a stop can stand off the road: the line starts and ends exactly on the stop dots
		const stops = leg.codes.map(at).filter((p): p is [number, number] => !!p);
		const road = roadBetween(shapes, leg.p, leg.i, leg.j);
		const line = road && stops.length ? [stops[0], ...road, stops[stops.length - 1]] : stops;
		if (!line.length) return;
		const color = cssVar(`--${leg.mode}`);
		if (prevEnd)
			L.polyline([prevEnd, line[0]], { color: '#94a3b8', weight: 3, dashArray: '2 7' }).addTo(m);
		L.polyline(line, { color, weight: 4, opacity: 1 }).addTo(m);
		pts.push(...line);
		// the stops on the way: small dots; the name shows on tap, and for all of them when zoomed in
		for (const code of leg.codes.slice(1, -1)) {
			const p = at(code);
			if (!p) continue;
			L.circleMarker(p, {
				radius: 3.5,
				color,
				fillColor: cssVar('--bg'),
				fillOpacity: 1,
				weight: 2,
				interactive: false,
			}).addTo(m);
			// a larger invisible target so a finger can hit it
			const hit = L.circleMarker(p, { radius: 13, stroke: false, fillOpacity: 0 }).addTo(m);
			hit.bindTooltip(esc(stopNameByCode(code)), {
				permanent: true,
				direction: 'top',
				offset: [0, -4],
				className: 'pk-tip pk-mid',
			});
			hit.on('click', () => hit.getTooltip()?.getElement()?.classList.toggle('pk-show'));
		}
		prevEnd = line[line.length - 1];
	});
	const first = j.legs[0].codes[0];
	const last = j.legs[j.legs.length - 1].codes.at(-1);
	if (first) dot(first, cssVar('--ok'), true);
	if (j.legs.length > 1) {
		// crossing the street: two stops of the same name – both are drawn, but labelled once
		const alight = j.legs[0].codes.at(-1) ?? '';
		const board = j.legs[1].codes[0];
		const same = stopNameByCode(board) === stopNameByCode(alight);
		dot(alight, '#e2e8f0', false, same ? 'top' : 'left');
		dot(board, '#e2e8f0', false, 'right', !same);
	}
	if (last) dot(last, cssVar('--soon'), true, j.legs.length > 1 ? 'right' : 'top');
	const fit = () => {
		if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], animate: false });
	};
	const zoomClass = () => el.classList.toggle('tp-zoomed', m.getZoom() >= 16);
	m.on('zoomend', zoomClass);
	fit();
	zoomClass();
	return { m, fit };
}

/** bottom sheet for a tapped departure: the route on a mini map, the steps, and the notification switch */
export async function openTrip(loc: LocationCfg, key: string) {
	closeTrip();
	root ??= document.getElementById('trip');
	if (!root) return;
	const goal = selectedGoal(loc);
	await ensureGtfs();
	ensureGeo();
	await loadStops().catch(() => []);
	const shapes = await loadShapes();
	const elapsed = state.fetchedAt ? (Date.now() - state.fetchedAt) / 1000 : 0;
	const row = locationRows(loc, goal, elapsed).find((r) => rowKey(r) === key);
	if (!row) return;
	const j = state.gtfs ? journeyOf(state.gtfs, row, goal, nearStops) : null;
	const watching = () => state.watch?.pin === key;
	const dest = row.arrive ? row.arrive.stopName : row.dep.dest;
	const sub = [
		row.leaveInSec < 60 ? t('leave.now') : t('leave.in', { t: fmtMinutes(row.leaveInSec) }),
		row.arrive ? `${t('card.arrival').toLowerCase()} ${fmtClock(row.arrive.sec)}` : '',
	]
		.filter(Boolean)
		.join(' · ');
	const bellLabel = () => (watching() ? `🔕 ${t('trip.notifyOff')}` : `🔔 ${t('trip.notify')}`);
	root.hidden = false;
	root.innerHTML = `
    <div class="pk-bg" data-tp="close"></div>
    <div class="tp-sheet" role="dialog" aria-modal="true">
      <div class="tp-grab"></div>
      <div class="tp-head">
        ${badge(row.dep.route, row.dep.mode)}
        <div class="tp-title"><b>${esc(dest)}</b><span class="muted">${esc(sub)}</span></div>
        <button class="icon" data-tp="close" aria-label="${t('trip.close')}">✕</button>
      </div>
      ${j ? '<div id="tp-map"></div>' : `<p class="muted">${t('trip.noMap')}</p>`}
      ${steps(row, j)}
      <button class="btn primary tp-bell" data-tp="watch">${bellLabel()}</button>
    </div>`;
	if (j) {
		const el = document.getElementById('tp-map');
		if (el) {
			const { m, fit } = draw(el, j, shapes);
			map = m;
			// the sheet has just been laid out: re-measure, then fit the route into the real size
			setTimeout(() => {
				m.invalidateSize();
				fit();
			}, 50);
		}
	}
	const bell = root.querySelector<HTMLElement>('.tp-bell');
	root.onclick = async (e) => {
		const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tp]');
		if (el?.dataset.tp === 'close') closeTrip();
		else if (el?.dataset.tp === 'watch') {
			await toggleWatch(loc, key);
			if (bell) bell.textContent = bellLabel();
		}
	};
}

document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && tripOpen()) closeTrip();
});
