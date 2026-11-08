import L from 'leaflet';
import { t } from './i18n.ts';
import 'leaflet/dist/leaflet.css';
import { distanceM, type StopInfo } from './stops.ts';

export interface PickerOpts {
	all: StopInfo[];
	/** picking stops of a destination rather than a boarding stop */
	goal: boolean;
	taken: ReadonlySet<number>;
	center?: { la: number; lo: number };
	/** destinations seen live at a stop (undefined = not loaded yet) */
	dests: (siri: number) => string[] | undefined;
	peek: (ids: number[]) => void;
	/** routes serving a stop (from the timetable), shown when picking a goal */
	routesAt?: (code: string) => string[] | undefined;
	onPick: (s: StopInfo) => void;
}

const TALLINN = { la: 59.437, lo: 24.745 };
const MIN_ZOOM_STOPS = 14;
const esc = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
	);

let root: HTMLElement | null = null;
let st: {
	opts: PickerOpts;
	map: L.Map;
	layer: L.LayerGroup;
	q: string;
	sel?: StopInfo;
	visible: StopInfo[];
} | null = null;

export function openPicker(opts: PickerOpts) {
	closePicker();
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
	const map = L.map('pk-map', { zoomControl: false, attributionControl: true }).setView(
		[c.la, c.lo],
		opts.center ? 17 : 14,
	);
	L.control.zoom({ position: 'topright' }).addTo(map);
	// plain OSM tiles (no API key); the dark look comes from a CSS filter on .leaflet-tile-pane
	L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
		maxZoom: 19,
		attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
	}).addTo(map);
	const layer = L.layerGroup().addTo(map);
	st = { opts, map, layer, q: '', visible: [] };
	map.on('moveend', redraw);
	redraw();
	// the map needs a size recalculation once the sheet has been laid out
	setTimeout(() => map.invalidateSize(), 50);
}

export function closePicker() {
	if (!st) return;
	st.map.remove();
	st = null;
	if (root) {
		root.hidden = true;
		root.innerHTML = '';
	}
}

export const pickerOpen = () => st !== null;

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
	layer.clearLayers();
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
		for (const s of st.visible) {
			const taken = opts.taken.has(s.s),
				sel = st.sel?.s === s.s;
			const m = L.circleMarker([s.la, s.lo], {
				radius: sel ? 11 : z >= 16 ? 8 : 5,
				color: sel ? '#fbbf24' : taken ? '#64748b' : '#38bdf8',
				fillColor: sel ? '#fbbf24' : taken ? '#334155' : '#0b0f19',
				fillOpacity: 1,
				weight: sel ? 4 : 3,
			}).addTo(layer);
			m.on('click', () => select(s, false));
			if (z >= 17 || sel)
				m.bindTooltip(esc(s.n), {
					permanent: true,
					direction: 'top',
					offset: [0, -8],
					className: 'pk-tip',
				});
		}
	} else st.visible = [];
	renderList();
	renderSel();
}

function select(s: StopInfo, fly: boolean) {
	if (!st) return;
	st.sel = s;
	// flyTo emits no 'moveend' when the view does not change, so refresh the UI explicitly
	if (fly) {
		st.map.flyTo([s.la, s.lo], Math.max(st.map.getZoom(), 17), { duration: 0.6 });
		renderSel();
		renderList();
	} else redraw();
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
	const d = st!.opts.dests(s.s);
	return d === undefined
		? '<span class="muted">…</span>'
		: d.length
			? `<span class="dirs">→ ${d.slice(0, 3).map(esc).join(' · ')}</span>`
			: `<span class="warn">${t('pk.noLive')}</span>`;
}

function renderList() {
	if (!st) return;
	const ul = document.getElementById('pk-list')!;
	const items = listItems();
	if (!st.q && st.map.getZoom() < MIN_ZOOM_STOPS) {
		ul.innerHTML = `<li class="muted">${t('pk.zoom')}</li>`;
		return;
	}
	if (!st.opts.goal) st.opts.peek(items.slice(0, 8).map((s) => s.s));
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
