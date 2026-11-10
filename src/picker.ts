import type L from 'leaflet';
import { t } from './i18n.ts';
import { loadMapLib, type MapLib } from './maps.ts';
import { distanceM, type StopInfo } from './stops.ts';
import { esc } from './util.ts';

export interface PickerOpts {
	all: StopInfo[];
	/** picking stops of a destination rather than a boarding stop */
	goal: boolean;
	taken: ReadonlySet<number>;
	center?: { la: number; lo: number };
	/** a stop that is already selected when the map opens */
	preselect?: StopInfo;
	/** destinations seen live at a stop (undefined = not loaded yet) */
	dests: (siri: number) => string[] | undefined;
	peek: (ids: number[]) => void;
	/** routes serving a stop (from the timetable) */
	routesAt?: (code: string) => string[] | undefined;
	onPick: (s: StopInfo) => void;
}

const TALLINN = { la: 59.437, lo: 24.745 };
const MIN_ZOOM_STOPS = 14;
/** live info for the listed stops is asked for once the map or the search field has come to rest */
const PEEK_DELAY_MS = 250;

let root: HTMLElement | null = null;
let peekTimer: ReturnType<typeof setTimeout> | undefined;
let st: {
	opts: PickerOpts;
	lib: MapLib;
	map: L.Map;
	layer: L.LayerGroup;
	q: string;
	sel?: StopInfo;
	visible: StopInfo[];
	markers: Map<number, { marker: L.CircleMarker; style: string }>;
} | null = null;

export async function openPicker(opts: PickerOpts) {
	const lib = await loadMapLib();
	closePicker(); // after the wait: of two quick calls the later one wins
	root ??= document.getElementById('picker')!;
	root.hidden = false;
	root.innerHTML = `
    <div class="pk-bg" data-pk="close"></div>
    <div class="pk-sheet">
      <div class="pk-head">
        <input id="pk-q" placeholder="${t('pk.search')}" autocomplete="off" />
        <button class="icon" data-pk="geo" aria-label="${t('pk.geo')}">📍</button>
        <button class="icon" data-pk="close" aria-label="${t('pk.close')}">✕</button>
      </div>
      <div id="pk-map"></div>
      <div id="pk-sel"></div>
      <ul id="pk-list"></ul>
    </div>`;
	const c = opts.center ?? TALLINN;
	const { L } = lib;
	const map = lib.tileMap('pk-map').setView([c.la, c.lo], opts.center ? 17 : 14);
	L.control.zoom({ position: 'topright' }).addTo(map);
	const layer = L.layerGroup().addTo(map);
	st = { opts, lib, map, layer, q: '', visible: [], sel: opts.preselect, markers: new Map() };
	if (opts.preselect) opts.peek([opts.preselect.s]);
	map.on('moveend', redraw);
	redraw();
	// the map needs a size recalculation once the sheet has been laid out (unless it is closed by then)
	setTimeout(() => {
		if (st?.map === map) map.invalidateSize();
	}, 50);
}

export function closePicker() {
	if (!st) return;
	clearTimeout(peekTimer);
	st.map.remove();
	st = null;
	if (root) {
		root.hidden = true;
		root.innerHTML = '';
	}
}

/** call when live info for some stop arrived */
export function refreshPicker() {
	if (st) {
		renderSel();
		renderList();
	}
}

function redraw() {
	if (!st) return;
	const { map, layer, opts } = st;
	const { L } = st.lib;
	const z = map.getZoom();
	if (z >= MIN_ZOOM_STOPS) {
		const b = map.getBounds();
		st.visible = opts.all.filter((s) => b.contains([s.la, s.lo]));
		const c = map.getCenter();
		if (st.visible.length > 400)
			st.visible = st.visible
				.map((s) => ({ s, d: distanceM(c.lat, c.lng, s.la, s.lo) }))
				.sort((a, b) => a.d - b.d)
				.slice(0, 400)
				.map((x) => x.s);
	} else st.visible = [];
	const visibleIds = new Set(st.visible.map((s) => s.s));
	for (const [id, entry] of st.markers) {
		if (visibleIds.has(id)) continue;
		layer.removeLayer(entry.marker);
		st.markers.delete(id);
	}
	// markers are kept between redraws; a new one is drawn on top of the old ones, so the order has to be put right
	let reorder = false;
	for (const s of st.visible) {
		const taken = opts.taken.has(s.s);
		const sel = st.sel?.s === s.s;
		const style = `${sel}|${taken}|${z >= 16}`;
		let entry = st.markers.get(s.s);
		if (!entry) {
			const marker = L.circleMarker([s.la, s.lo]).addTo(layer);
			marker.on('click', () => select(s, false));
			entry = { marker, style: '' };
			st.markers.set(s.s, entry);
			reorder = true;
		}
		const m = entry.marker;
		if (entry.style !== style) {
			m.setStyle({
				radius: sel ? 11 : z >= 16 ? 8 : 5,
				color: sel ? '#fbbf24' : taken ? '#64748b' : '#38bdf8',
				fillColor: sel ? '#fbbf24' : taken ? '#334155' : '#0b0f19',
				fillOpacity: 1,
				weight: sel ? 4 : 3,
			});
			entry.style = style;
		}
		if (z >= 17 || sel) {
			if (!m.getTooltip()) {
				m.bindTooltip(esc(s.n), {
					permanent: true,
					direction: 'top',
					offset: [0, -8],
					className: 'pk-tip',
				});
				reorder = true;
			}
		} else if (m.getTooltip()) m.unbindTooltip();
	}
	// the order of the list: of two stops that overlap, the same one is on top wherever the map came from
	if (reorder) {
		for (const s of st.visible) {
			const m = st.markers.get(s.s)?.marker;
			m?.bringToFront();
			m?.getTooltip()?.bringToFront();
		}
	}
	renderList();
	renderSel();
}

function select(s: StopInfo, fly: boolean) {
	if (!st) return;
	st.sel = s;
	// flyTo emits no 'moveend' when the view does not change, so the map is redrawn here in any case
	if (fly) st.map.flyTo([s.la, s.lo], Math.max(st.map.getZoom(), 17), { duration: 0.6 });
	redraw();
	st.opts.peek([s.s]);
}

function listItems(): (StopInfo & { dist: number })[] {
	if (!st) return [];
	const c = st.map.getCenter();
	const q = st.q.trim().toLowerCase();
	const pool = q
		? st.opts.all.filter((s) => `${s.n} ${s.ar}`.toLowerCase().includes(q))
		: st.visible;
	return pool
		.filter((s) => !st!.opts.taken.has(s.s))
		.map((s) => ({ ...s, dist: distanceM(c.lat, c.lng, s.la, s.lo) }))
		.sort((a, b) => a.dist - b.dist)
		.slice(0, 10);
}

function dirHtml(s: StopInfo): string {
	if (st!.opts.goal) {
		const r = st!.opts.routesAt?.(s.id);
		return r?.length
			? `<span class="dirs">${t('pk.routes')}${r.slice(0, 8).map(esc).join(' · ')}</span>`
			: '';
	}
	const routes = st!.opts.routesAt?.(s.id) ?? [];
	const d = st!.opts.dests(s.s);
	if (!routes.length && d === undefined) return '<span class="muted">…</span>';
	if (!routes.length && !d?.length) return `<span class="warn">${t('pk.noLive')}</span>`;
	const via = routes.slice(0, 8).map(esc).join(' · ');
	const to = d?.length ? `→ ${d.slice(0, 3).map(esc).join(' · ')}` : '';
	return `<span class="dirs">${[via, to].filter(Boolean).join(' ')}</span>`;
}

function renderList() {
	if (!st) return;
	const ul = document.getElementById('pk-list')!;
	const items = listItems();
	if (!st.q && st.map.getZoom() < MIN_ZOOM_STOPS) {
		ul.innerHTML = `<li class="muted">${t('pk.zoom')}</li>`;
		return;
	}
	if (!st.opts.goal) {
		const ids = items.slice(0, 8).map((s) => s.s);
		clearTimeout(peekTimer);
		peekTimer = setTimeout(() => st?.opts.peek(ids), PEEK_DELAY_MS);
	}
	ul.innerHTML =
		items
			.map(
				(s) => `
    <li data-pk="item" data-siri="${s.s}" class="${st!.sel?.s === s.s ? 'sel' : ''}">
      <div class="r-main"><b>${esc(s.n)}</b> ${dirHtml(s)}
        <div class="muted r-sub">${esc(s.ar)}</div></div>
      <span class="muted r-side">${Math.round(s.dist)} ${t('unit.m')}</span>
    </li>`,
			)
			.join('') || `<li class="muted">${t('pk.none')}</li>`;
}

function renderSel() {
	if (!st) return;
	const el = document.getElementById('pk-sel')!;
	const s = st.sel;
	if (!s) {
		el.innerHTML = `<div class="muted pk-hint">${t('pk.hint')}</div>`;
		return;
	}
	const taken = st.opts.taken.has(s.s);
	el.innerHTML = `
    <div class="pk-card">
      <div class="pk-card-main"><b>${esc(s.n)}</b> ${dirHtml(s)}
        <div class="muted r-sub">${esc(s.ar)}${s.ar ? ' · ' : ''}#${s.s}</div></div>
      <button class="btn primary" data-pk="add" ${taken ? 'disabled' : ''}>${taken ? t('pk.taken') : t('pk.add')}</button>
    </div>`;
}

document.addEventListener('click', (e) => {
	if (!st) return;
	const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pk]');
	if (!el) return;
	switch (el.dataset.pk) {
		case 'close':
			closePicker();
			break;
		case 'item': {
			const s = st.opts.all.find((x) => x.s === Number(el.dataset.siri));
			if (s) select(s, true);
			break;
		}
		case 'add': {
			const { sel, opts } = st;
			if (sel && !opts.taken.has(sel.s)) {
				closePicker();
				opts.onPick(sel);
			}
			break;
		}
		case 'geo':
			navigator.geolocation?.getCurrentPosition(
				(p) => st?.map.setView([p.coords.latitude, p.coords.longitude], 17),
				() => alert(t('pk.geoFail')),
				{ enableHighAccuracy: true, timeout: 10000 },
			);
			break;
	}
});

document.addEventListener('input', (e) => {
	const el = e.target as HTMLInputElement;
	if (st && el.id === 'pk-q') {
		st.q = el.value;
		renderList();
	}
});
