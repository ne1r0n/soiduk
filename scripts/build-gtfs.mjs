// Downloads the Tallinn GTFS feed and writes a compact index public/gtfs.json
// used by the browser to answer: "if I board trip X at stop A, when do I reach stop B?"
//
// Trips are grouped into patterns (route + stop list + time offsets from the first stop),
// so a pattern is stored once and every trip is just [pattern, startSec, service].

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'https://transport.tallinn.ee/data/gtfs.zip';
const dir = await mkdtemp(join(tmpdir(), 'gtfs-'));
const zip = join(dir, 'g.zip');
const res = await fetch(SRC);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
await writeFile(zip, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-oq', zip, '-d', dir]);

function csv(text) {
	text = text.replace(/^﻿/, '');
	const rows = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line) continue;
		const out = [];
		let cur = '',
			q = false;
		for (let i = 0; i < line.length; i++) {
			const c = line[i];
			if (q) {
				if (c === '"') {
					if (line[i + 1] === '"') {
						cur += '"';
						i++;
					} else q = false;
				} else cur += c;
			} else if (c === '"') q = true;
			else if (c === ',') {
				out.push(cur);
				cur = '';
			} else cur += c;
		}
		out.push(cur);
		rows.push(out);
	}
	const head = rows.shift();
	return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const read = async (n) => csv(await readFile(join(dir, `${n}.txt`), 'utf8'));
const sec = (t) => {
	const [h, m, s] = t.split(':').map(Number);
	return h * 3600 + m * 60 + s;
};

const stopRows = await read('stops');
const stops = new Map(stopRows.map((s) => [s.stop_id, s.stop_code]));
const stopLL = new Map(stopRows.map((s) => [s.stop_code, [+s.stop_lat, +s.stop_lon]]));
const routeRows = await read('routes');
const routes = new Map(routeRows.map((r) => [r.route_id, r.route_short_name]));
// GTFS route_type: 900 tram, 800 trolleybus, otherwise bus
const modes = new Map(
	routeRows.map((r) => [
		r.route_id,
		r.route_type === '900' ? 'tram' : r.route_type === '800' ? 'trol' : 'bus',
	]),
);
const trips = new Map((await read('trips')).map((t) => [t.trip_id, t]));

const byTrip = new Map();
for (const st of await read('stop_times')) {
	const a = byTrip.get(st.trip_id) ?? [];
	a.push(st);
	byTrip.set(st.trip_id, a);
}

const services = [];
const svcIdx = new Map();
const svc = (id) => {
	if (!svcIdx.has(id)) {
		svcIdx.set(id, services.length);
		services.push(id);
	}
	return svcIdx.get(id);
};

const patterns = [];
const patShape = []; // pattern -> shape_id of its first trip
const patIdx = new Map();
const out = [];
for (const [tid, sts] of byTrip) {
	const t = trips.get(tid);
	if (!t) continue;
	sts.sort((a, b) => a.stop_sequence - b.stop_sequence);
	const start = sec(sts[0].departure_time);
	const codes = sts.map((s) => stops.get(s.stop_id));
	const offs = sts.map((s) => sec(s.arrival_time) - start);
	const mode = modes.get(t.route_id);
	const key =
		mode +
		'|' +
		routes.get(t.route_id) +
		'|' +
		t.trip_headsign +
		'|' +
		codes.join(',') +
		'|' +
		offs.join(',');
	let p = patIdx.get(key);
	if (p === undefined) {
		p = patterns.length;
		patIdx.set(key, p);
		patterns.push({ r: routes.get(t.route_id), m: mode, h: t.trip_headsign, s: codes, o: offs });
		patShape.push(t.shape_id);
	}
	out.push([p, start, svc(t.service_id)]);
}

const cal = new Map((await read('calendar')).map((c) => [c.service_id, c]));
const exc = new Map();
for (const e of await read('calendar_dates')) {
	if (!exc.has(e.service_id)) exc.set(e.service_id, { add: [], del: [] });
	exc.get(e.service_id)[e.exception_type === '1' ? 'add' : 'del'].push(e.date);
}
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const svcOut = services.map((id) => {
	const c = cal.get(id);
	return {
		d: c ? days.map((d) => c[d]).join('') : '0000000', // index = JS getDay()
		a: c?.start_date ?? '',
		b: c?.end_date ?? '',
		x: exc.get(id)?.add ?? [],
		y: exc.get(id)?.del ?? [],
	};
});

out.sort((a, b) => a[1] - b[1]);
const json = JSON.stringify({ patterns, trips: out, services: svcOut });
await writeFile(new URL('../public/gtfs.json', import.meta.url), json);
console.log(
	`patterns=${patterns.length} trips=${out.length} services=${svcOut.length} size=${(json.length / 1e6).toFixed(2)}MB`,
);

// ---- shapes: the real road geometry, for drawing routes on the map (loaded lazily by the trip sheet) ----
const raw = new Map();
for (const r of await read('shapes')) {
	const a = raw.get(r.shape_id) ?? [];
	a.push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]);
	raw.set(r.shape_id, a);
}
const KLON = Math.cos((59.43 * Math.PI) / 180);
// Douglas–Peucker in metres (local flat projection), iterative to avoid deep recursion
function simplify(pts, tol) {
	const xy = pts.map(([la, lo]) => [lo * KLON * 111320, la * 111320]);
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack = [[0, pts.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop();
		let worst = -1,
			wi = 0;
		const [ax, ay] = xy[a],
			[bx, by] = xy[b];
		const dx = bx - ax,
			dy = by - ay,
			len = dx * dx + dy * dy;
		for (let i = a + 1; i < b; i++) {
			const [px, py] = xy[i];
			let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
			t = Math.max(0, Math.min(1, t));
			const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
			if (d > worst) {
				worst = d;
				wi = i;
			}
		}
		if (worst > tol) {
			keep[wi] = 1;
			stack.push([a, wi], [wi, b]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}
const shapeIds = [];
const shapeIdx = new Map();
const shapes = [];
const simplified = new Map();
const encode = (pts) => {
	const o = [];
	let pla = 0,
		plo = 0;
	for (const [la, lo] of pts) {
		const a = Math.round(la * 1e5),
			b = Math.round(lo * 1e5);
		o.push(a - pla, b - plo);
		pla = a;
		plo = b;
	}
	return o;
};
const pat = patterns.map((p, n) => {
	const id = patShape[n];
	if (!raw.has(id)) return null;
	if (!shapeIdx.has(id)) {
		const pts = raw
			.get(id)
			.sort((a, b) => a[0] - b[0])
			.map(([, la, lo]) => [la, lo]);
		const sp = simplify(pts, 3);
		simplified.set(id, sp);
		shapeIdx.set(id, shapes.length);
		shapes.push(encode(sp));
	}
	// where each stop sits along the shape: nearest point, never going backwards
	const sp = simplified.get(id);
	let from = 0;
	const at = p.s.map((code) => {
		const ll = stopLL.get(code);
		if (!ll) return from;
		let best = from,
			bd = Infinity;
		for (let k = from; k < sp.length; k++) {
			const d = Math.hypot((sp[k][1] - ll[1]) * KLON, sp[k][0] - ll[0]);
			if (d < bd) {
				bd = d;
				best = k;
			}
		}
		from = best;
		return best;
	});
	return [shapeIdx.get(id), at];
});
const sj = JSON.stringify({ shapes, pat });
await writeFile(new URL('../public/shapes.json', import.meta.url), sj);
console.log(`shapes=${shapes.length} size=${(sj.length / 1e6).toFixed(2)}MB`);
