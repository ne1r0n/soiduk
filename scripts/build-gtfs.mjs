// Downloads the Tallinn GTFS feed and writes a compact index public/gtfs.json
// used by the browser to answer: "if I board trip X at stop A, when do I reach stop B?"
//
// Trips are grouped into patterns (route + stop list + time offsets from the first stop),
// so a pattern is stored once and every trip is just [pattern, startSec, service].
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); rows.push(out);
  }
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const read = async n => csv(await readFile(join(dir, n + '.txt'), 'utf8'));
const sec = t => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };

const stops = new Map((await read('stops')).map(s => [s.stop_id, s.stop_code]));
const routeRows = await read('routes');
const routes = new Map(routeRows.map(r => [r.route_id, r.route_short_name]));
// GTFS route_type: 900 tram, 800 trolleybus, otherwise bus
const modes = new Map(routeRows.map(r => [r.route_id, r.route_type === '900' ? 'tram' : r.route_type === '800' ? 'trol' : 'bus']));
const trips = new Map((await read('trips')).map(t => [t.trip_id, t]));

const byTrip = new Map();
for (const st of await read('stop_times')) {
  let a = byTrip.get(st.trip_id);
  if (!a) byTrip.set(st.trip_id, a = []);
  a.push(st);
}

const services = []; const svcIdx = new Map();
const svc = id => { if (!svcIdx.has(id)) { svcIdx.set(id, services.length); services.push(id); } return svcIdx.get(id); };

const patterns = []; const patIdx = new Map(); const out = [];
for (const [tid, sts] of byTrip) {
  const t = trips.get(tid); if (!t) continue;
  sts.sort((a, b) => a.stop_sequence - b.stop_sequence);
  const start = sec(sts[0].departure_time);
  const codes = sts.map(s => stops.get(s.stop_id));
  const offs = sts.map(s => sec(s.arrival_time) - start);
  const mode = modes.get(t.route_id);
  const key = mode + '|' + routes.get(t.route_id) + '|' + t.trip_headsign + '|' + codes.join(',') + '|' + offs.join(',');
  let p = patIdx.get(key);
  if (p === undefined) {
    p = patterns.length; patIdx.set(key, p);
    patterns.push({ r: routes.get(t.route_id), m: mode, h: t.trip_headsign, s: codes, o: offs });
  }
  out.push([p, start, svc(t.service_id)]);
}

const cal = new Map((await read('calendar')).map(c => [c.service_id, c]));
const exc = new Map();
for (const e of await read('calendar_dates')) {
  if (!exc.has(e.service_id)) exc.set(e.service_id, { add: [], del: [] });
  exc.get(e.service_id)[e.exception_type === '1' ? 'add' : 'del'].push(e.date);
}
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const svcOut = services.map(id => {
  const c = cal.get(id);
  return {
    d: c ? days.map(d => c[d]).join('') : '0000000', // index = JS getDay()
    a: c?.start_date ?? '', b: c?.end_date ?? '',
    x: exc.get(id)?.add ?? [], y: exc.get(id)?.del ?? [],
  };
});

out.sort((a, b) => a[1] - b[1]);
const json = JSON.stringify({ patterns, trips: out, services: svcOut });
await writeFile(new URL('../public/gtfs.json', import.meta.url), json);
console.log(`patterns=${patterns.length} trips=${out.length} services=${svcOut.length} size=${(json.length / 1e6).toFixed(2)}MB`);
