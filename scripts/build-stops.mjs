// Downloads stops.txt from transport.tallinn.ee and writes a compact public/stops.json
// Row format: ID;SiriID;Lat;Lng;Stops;Name;Info;Street;Area;City
// Name is omitted (row has only 5 fields) when equal to the previous row's name.
import { writeFile } from 'node:fs/promises';

const SRC = 'https://transport.tallinn.ee/data/stops.txt';
const res = await fetch(SRC);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const text = (await res.text()).replace(/^﻿/, '');

const out = [];
const nameById = new Map();
let lastName = '';
for (const line of text.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const f = line.split(';');
  const [id, siri, lat, lng] = f;
  const name = f[5] || lastName;
  if (f[5]) lastName = f[5];
  nameById.set(id, name);
  if (!siri || !/^\d+$/.test(siri)) continue; // area rows / no realtime id
  out.push({
    s: Number(siri),
    n: name,
    st: f[7] && f[7] !== '0' ? f[7] : '',
    la: Number(lat) / 1e5,
    lo: Number(lng) / 1e5,
    id,
    ar: f[8] && f[8] !== '0' ? f[8] : '',
    nbIds: (f[4] || '').split(','),
  });
}
for (const o of out) {
  o.nb = [...new Set(o.nbIds.map(i => nameById.get(i)).filter(n => n && n !== o.n))];
  delete o.nbIds;
}
await writeFile(new URL('../public/stops.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${out.length} stops`);
