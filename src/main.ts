import './style.css';
import { fetchDepartures, type Mode, type StopDepartures } from './api.ts';
import { buildRows, clearArrivalCache, fmtClock, fmtMinutes, type GoalCfg, type LocationCfg, type Row, type StopCfg } from './plan.ts';
import { load, loadPrev, loadSelection, save, savePrev, saveSelection, sanitize, uid, type Config } from './store.ts';
import { decodeConfig, encodeConfig, slim } from './share.ts';
import { KOFI_URL } from './config.ts';
import { loadStops, type StopInfo } from './stops.ts';
import { buildIndex, type GtfsIndex } from './trip.ts';
import { closePicker, openPicker, refreshPicker } from './picker.ts';

const REFRESH_MS = 20_000;
const MAX_EXTRA_ROWS = 3;

let cfg: Config = load();
let view: 'dash' | 'edit' = cfg.locations.length ? 'dash' : 'edit';
let data = new Map<number, StopDepartures>();
let fetchedAt = 0;
let failed = new Set<number>();
let loading = false;
let lastOk = true;
/** routes seen live at a stop – used for chips in the editor */
const knownRoutes = new Map<number, string[]>();
/** destinations seen live at a stop, most frequent first – tells you which way it goes */
const knownDests = new Map<number, string[]>();
const peekPending = new Set<number>();

function remember(id: number, d: StopDepartures) {
  knownRoutes.set(id, [...new Set(d.items.map(i => i.route))].sort(routeSort));
  const cnt = new Map<string, number>();
  for (const i of d.items) cnt.set(i.dest, (cnt.get(i.dest) ?? 0) + 1);
  knownDests.set(id, [...cnt].sort((a, b) => b[1] - a[1]).map(x => x[0]));
}

/** lazily load live info for stops shown in the picker */
function peek(ids: number[]) {
  for (const id of ids) {
    if (knownDests.has(id) || peekPending.has(id)) continue;
    peekPending.add(id);
    fetchDepartures(id).then(d => remember(id, d)).catch(() => {}).finally(() => {
      peekPending.delete(id);
      refreshPicker();
      if (view === 'edit') scheduleRender();
    });
  }
}
let renderTimer = 0;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 150);
}

// ---------- timetable (GTFS), loaded lazily when a goal is shown ----------
let selection = loadSelection();
let gtfs: GtfsIndex | null = null;
let gtfsState: 'idle' | 'loading' | 'error' = 'idle';
let gtfsPromise: Promise<void> | null = null;
function ensureGtfs(): Promise<void> {
  if (gtfsPromise) return gtfsPromise;
  gtfsState = 'loading';
  return gtfsPromise = fetch(`${import.meta.env.BASE_URL}gtfs.json`)
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(raw => { gtfs = buildIndex(raw); gtfsState = 'idle'; clearArrivalCache(); render(); })
    .catch(() => { gtfsState = 'error'; render(); });
}
/** undefined = show all departures */
function selectedGoal(loc: LocationCfg): GoalCfg | undefined {
  const goals = loc.goals ?? [];
  const id = selection[loc.id];
  if (id === '') return undefined;
  return goals.find(g => g.id === id) ?? (id === undefined ? goals[0] : undefined);
}

const app = document.getElementById('app')!;
const liveEl = document.getElementById('live')!;
const liveText = document.getElementById('live-text')!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const modeClass: Record<Mode, string> = { bus: 'bus', trol: 'trol', tram: 'tram', other: 'bus' };

// ---------- data ----------
async function refresh() {
  if (loading) return;
  loading = true;
  updateLive();
  const ids = [...new Set(cfg.locations.flatMap(l => l.stops.map(s => s.siriId)))];
  const next = new Map<number, StopDepartures>();
  const bad = new Set<number>();
  await Promise.all(ids.map(async id => {
    try {
      const d = await fetchDepartures(id);
      next.set(id, d);
      remember(id, d);
    } catch {
      bad.add(id);
      const old = data.get(id);
      if (old) next.set(id, { now: old.now + (Date.now() - fetchedAt) / 1000, items: old.items });
    }
  }));
  data = next; failed = bad; fetchedAt = Date.now(); loading = false;
  clearArrivalCache();
  lastOk = bad.size < Math.max(ids.length, 1);
  updateLive();
  render();
}

function routeSort(a: string, b: string) {
  const na = parseInt(a), nb = parseInt(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

// ---------- dashboard ----------
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

/** "выйти через 5 мин" / "выйти сейчас" */
function leaveText(sec: number): string {
  return sec < 60 ? 'выйти сейчас' : `выйти через ${fmtMinutes(sec)}`;
}

function stopDirection(stop: StopCfg): string {
  if (stop.label) return esc(stop.label);
  const d = knownDests.get(stop.siriId) ?? [];
  return d.length ? `→ ${d.slice(0, 2).map(esc).join(' · ')}` : '';
}

/** One card = one stop (walking time differs per stop, so schedules must not be mixed) */
function stopCard(loc: LocationCfg, stop: StopCfg, goal: GoalCfg | undefined, idx: GtfsIndex | null, elapsed: number): { html: string; empty: boolean } {
  const walk = stop.walkMin ?? loc.walkMin;
  const one: LocationCfg = { id: `${loc.id}:${stop.siriId}`, name: loc.name, walkMin: walk, stops: [stop], goals: loc.goals };
  const dir = stopDirection(stop);
  const stale = failed.has(stop.siriId) ? ' <span class="stale" title="Данные устарели">⚠</span>' : '';
  const head = `<header>
      <div class="stop-title"><h2>${esc(stop.name)}</h2>${dir ? `<span class="dirs">${dir}</span>` : ''}</div>
      <span class="walk">🚶 ${walk} мин${stale}</span></header>`;
  const shell = (inner: string, cls = '') => ({ html: `<section class="card ${cls}">${head}${inner}</section>`, empty: false });
  if (!data.has(stop.siriId)) return shell(`<p class="muted">${loading || !fetchedAt ? 'Загрузка…' : 'Нет данных'}</p>`);

  const rows = buildRows(one, data, elapsed, 30, goal && idx ? { goal, idx } : undefined);
  if (!rows.length) {
    const r = shell(`<p class="muted">${goal ? `Рейсы с этой остановки не идут до «${esc(goal.name)}»` : 'Подходящих отправлений нет'}</p>`);
    return { ...r, empty: true };
  }

  const lvl = urgency(rows[0].leaveInSec);
  const list = rows.slice(0, 1 + MAX_EXTRA_ROWS).map(r => `
    <li>
      ${badge(r)}
      <span class="dest">${esc(r.arrive ? r.arrive.stopName : r.dep.dest)}</span>
      <span class="when">${fmtClock(r.arrive ? r.arrive.sec : r.dep.expected)}${delayTag(r.delaySec)}</span>
      <span class="in">${leaveText(r.leaveInSec)}${r.arrive ? ` · в пути ${Math.round(r.arrive.travelSec / 60)} мин` : ''}</span>
    </li>`).join('');
  return shell(`<ul class="rows">${list}</ul>`, lvl);
}

/** A location groups the cards of its stops and owns the goal selector */
function locationSection(loc: LocationCfg, elapsed: number): string {
  const goals = loc.goals ?? [];
  const goal = selectedGoal(loc);
  const bar = goals.length ? `<div class="goalbar">
      <button class="gchip ${goal ? '' : 'on'}" data-act="select-goal" data-gid="">Все</button>
      ${goals.map(g => `<button class="gchip ${goal?.id === g.id ? 'on' : ''}" data-act="select-goal" data-gid="${g.id}">→ ${esc(g.name)}</button>`).join('')}
    </div>` : '';
  const head = `<div class="loc-head"><h3>${esc(loc.name)}</h3>${bar}</div>`;
  const wrap = (inner: string) => `<section class="loc" data-loc="${loc.id}">${head}${inner}</section>`;
  const note = (msg: string) => wrap(`<section class="card"><p class="muted">${msg}</p></section>`);
  if (!loc.stops.length) return note('Нет остановок. Добавьте в настройках.');

  let idx: GtfsIndex | null = null;
  if (goal) {
    ensureGtfs();
    if (!gtfs) return note(gtfsState === 'error' ? 'Не удалось загрузить расписание (запустите npm run gtfs)' : 'Загрузка расписания…');
    idx = gtfs;
  }
  let cards = loc.stops.map(s => stopCard(loc, s, goal, idx, elapsed));
  // towards a goal, hide stops on the wrong side of the road – unless that leaves nothing
  if (goal && cards.some(c => !c.empty)) cards = cards.filter(c => !c.empty);
  return wrap(cards.map(c => c.html).join(''));
}

function dashboard(): string {
  const elapsed = fetchedAt ? (Date.now() - fetchedAt) / 1000 : 0;
  const body = cfg.locations.map(l => locationSection(l, elapsed)).join('');
  return `
    <main>${body}</main>`;
}

// ---------- editor ----------
function editor(): string {
  const locs = cfg.locations.map(l => `
    <section class="card edit" data-loc="${l.id}">
      <header>
        <input class="name" data-field="name" value="${esc(l.name)}" placeholder="Название (Дом, Работа…)" />
        <button class="icon danger" data-act="del-loc" aria-label="Удалить локацию">🗑</button>
      </header>
      <div class="sec-title">Остановки рядом</div>
      ${l.stops.map(s => stopEditor(s)).join('')}
      <button class="btn ghost" data-act="add-stop">＋ Остановка</button>
      <div class="sec-title">Куда еду</div>
      ${(l.goals ?? []).map(g => goalEditor(g)).join('')}
      <button class="btn ghost" data-act="add-goal">＋ Цель (например, торговый центр)</button>
    </section>`).join('');
  return `
    <div class="top"><h1>Настройки</h1>
      <div class="actions"><button class="btn" data-act="done">Готово</button></div></div>
    <main>
      ${locs || '<p class="muted">Добавьте первую локацию – например «Дом» – и выберите остановки рядом.</p>'}
      <button class="btn primary" data-act="add-loc">＋ Локация</button>
      <div class="sec-title">Резервная копия</div>
      <div class="io">
        <button class="btn" data-act="share-link">🔗 Ссылка</button>
        <button class="btn" data-act="export-file">⬇ Файл</button>
        <button class="btn" data-act="import-file">⬆ Загрузить</button>
      </div>
      ${loadPrev() ? '<button class="btn ghost" data-act="restore-prev">↩ Вернуть настройки, которые были до последней загрузки</button>' : ''}
      <p class="hint muted">Настройки хранятся только в этом браузере. Ссылка содержит их все: откройте её на другом устройстве или отправьте другу – предложат импортировать.</p>
      <footer class="about">
        ${KOFI_URL ? `<a class="kofi" href="${esc(KOFI_URL)}" target="_blank" rel="noopener">☕ Поддержать на Ko-fi</a>` : ''}
        <p class="muted">Данные: <a href="https://transport.tallinn.ee" target="_blank" rel="noopener">transport.tallinn.ee</a> · Карта © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>
      </footer>
    </main>
`;
}

function goalEditor(g: GoalCfg): string {
  return `
    <div class="stop" data-goal="${g.id}">
      <div class="stop-head">
        <input class="name" data-field="goal-name" value="${esc(g.name)}" placeholder="Название цели" />
        <button class="icon danger" data-act="del-goal" aria-label="Удалить цель">✕</button>
      </div>
      <div class="chips">
        ${g.stops.map(x => `<span class="chip on goal-stop ${x.pref ? 'pref' : ''}">
          <button class="x star" data-act="toggle-pref" data-code="${esc(x.code)}" aria-label="Предпочтительная" title="Предпочтительная остановка">${x.pref ? '★' : '☆'}</button>
          ${esc(x.name)} <small>${esc(x.code)}</small>
          <button class="x" data-act="del-goal-stop" data-code="${esc(x.code)}" aria-label="Убрать">✕</button></span>`).join('') || '<span class="muted">остановок нет</span>'}
      </div>
      <div class="hint muted">Показываем рейсы, которые доедут до одной из этих остановок, и время прибытия. ★ — предпочтительная: если рейс едет и до неё, покажем прибытие на неё, а не на более раннюю.</div>
      <button class="btn ghost" data-act="add-goal-stop">＋ Остановки у цели</button>
    </div>`;
}

function stopEditor(s: StopCfg): string {
  const routes = [...new Set([...(knownRoutes.get(s.siriId) ?? []), ...s.routes])].sort(routeSort);
  const chips = routes.length
    ? routes.map(r => `<button class="chip ${s.routes.includes(r) ? 'on' : ''}" data-act="toggle-route" data-route="${esc(r)}">${esc(r)}</button>`).join('')
    : knownRoutes.has(s.siriId)
      ? '<span class="warn">Нет онлайн-данных: у остановки нет рейсов в прогнозе (возможно, пригородная или не обслуживается сейчас)</span>'
      : '<span class="muted">маршруты загружаются…</span>';
  const dests = knownDests.get(s.siriId) ?? [];
  const where = s.area ?? '';
  const map = s.la && s.lo ? `<a class="maplink" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${s.la}&mlon=${s.lo}#map=18/${s.la}/${s.lo}">🗺 карта</a>` : '';
  return `
    <div class="stop" data-stop="${s.siriId}">
      <div class="stop-head"><b>${esc(s.name)}</b><span class="muted">#${s.siriId}</span>
        <button class="icon danger" data-act="del-stop" aria-label="Удалить остановку">✕</button></div>
      ${dests.length ? `<div class="dirs">→ ${dests.slice(0, 4).map(esc).join(' · ')}</div>` : ''}
      <label class="walk-edit">🚶 Пешком до этой остановки, мин
        <input type="number" min="0" max="60" inputmode="numeric" data-field="stop-walk" value="${s.walkMin ?? 5}" />
      </label>
      ${where || map ? `<div class="where muted">${esc(where)} ${map}</div>` : ''}
      <div class="chips">${chips}</div>
      <div class="hint muted">${s.routes.length ? 'Только выбранные маршруты' : 'Все маршруты – выберите нужные'}</div>
      <input class="dest-in" data-field="label" value="${esc(s.label ?? '')}" placeholder="Пометка на карточке (например, «в центр»)" />
    </div>`;
}

// ---------- picking stops on a map ----------
function centroid(pts: { la?: number; lo?: number }[]) {
  const p = pts.filter(x => x.la !== undefined && x.lo !== undefined) as { la: number; lo: number }[];
  return p.length ? { la: p.reduce((a, b) => a + b.la, 0) / p.length, lo: p.reduce((a, b) => a + b.lo, 0) / p.length } : undefined;
}

async function pickStop(loc: LocationCfg) {
  const all = await loadStops();
  openPicker({
    all, goal: false,
    taken: new Set(loc.stops.map(s => s.siriId)),
    center: centroid(loc.stops),
    dests: id => knownDests.get(id), peek,
    onPick: info => {
      loc.stops.push({ siriId: info.s, code: info.id, name: info.n, walkMin: loc.stops.at(-1)?.walkMin ?? loc.walkMin, routes: [], la: info.la, lo: info.lo, area: info.ar || undefined, nb: info.nb });
      fetchDepartures(info.s).then(d => { remember(info.s, d); if (view === 'edit') render(); }).catch(() => {});
      persist();
    },
  });
}

async function pickGoalStop(loc: LocationCfg, goal: GoalCfg) {
  const all = await loadStops();
  await ensureGtfs(); // routes at a stop help choosing the right side / the right stop
  openPicker({
    all, goal: true,
    taken: new Set(all.filter(s => goal.stops.some(g => g.code === s.id)).map(s => s.s)),
    center: centroid(all.filter(s => goal.stops.some(g => g.code === s.id))),
    dests: () => undefined, peek: () => {},
    routesAt: code => { const r = gtfs?.routesByStop.get(code); return r && [...r].sort(routeSort); },
    onPick: info => {
      if (!goal.stops.some(g => g.code === info.id)) goal.stops.push({ code: info.id, name: info.n });
      if (goal.name === 'Новая цель') goal.name = info.n;
      selection[loc.id] = goal.id; saveSelection(selection);
      persist();
    },
  });
}

// ---------- import / backup ----------
/** replaces the settings; the old ones stay available through «Вернуть предыдущие» */
function replaceConfig(next: Config) {
  if (cfg.locations.length) savePrev(cfg); // nothing worth undoing when starting from empty
  cfg = next;
  selection = {}; saveSelection(selection);
  persist();
  backfill();
  refresh();
}

function describe(c: Config): string {
  const stops = c.locations.reduce((n, l) => n + l.stops.length, 0);
  const goals = c.locations.reduce((n, l) => n + (l.goals?.length ?? 0), 0);
  return `локаций: ${c.locations.length}, остановок: ${stops}, целей: ${goals}`;
}

async function offerImport(next: Config, source: string) {
  const have = cfg.locations.length ? `Текущие настройки (${describe(cfg)}) будут заменены, но их можно вернуть.` : '';
  if (confirm(`Загрузить настройки из ${source}? ${describe(next)}. ${have}`)) { replaceConfig(next); view = 'dash'; render(); updateLive(); }
}

// ---------- render ----------
function render() {
  const active = document.activeElement as HTMLElement | null;
  // don't clobber text inputs while typing: editor re-renders only on structural changes
  if (view === 'edit' && active && active.tagName === 'INPUT' && !(active as HTMLInputElement).dataset.rerender) return;
  const scroll = window.scrollY;
  app.innerHTML = view === 'dash' ? dashboard() : editor();
  window.scrollTo(0, scroll);
}

function persist(rerender = true) { save(cfg); clearArrivalCache(); if (rerender) render(); }
const findLoc = (el: Element) => cfg.locations.find(l => l.id === el.closest<HTMLElement>('[data-loc]')?.dataset.loc);

async function onClick(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t) return;
  const act = t.dataset.act!;
  const loc = findLoc(t);
  const stopEl = t.closest<HTMLElement>('[data-stop]');
  const stop = loc?.stops.find(s => s.siriId === Number(stopEl?.dataset.stop));

  switch (act) {
    case 'reload': refresh(); break;
    case 'edit': view = 'edit'; render(); updateLive(); break;
    case 'done': view = 'dash'; closePicker(); render(); updateLive(); refresh(); break;
    case 'add-loc': cfg.locations.push({ id: uid(), name: cfg.locations.length ? 'Новая локация' : 'Дом', walkMin: 5, stops: [], goals: [] }); persist(); break;
    case 'select-goal': if (loc) { selection[loc.id] = t.dataset.gid ?? ''; saveSelection(selection); render(); } break;
    case 'add-goal': if (loc) { (loc.goals ??= []).push({ id: uid(), name: 'Новая цель', stops: [] }); persist(); } break;
    case 'del-goal': {
      const gid = t.closest<HTMLElement>('[data-goal]')?.dataset.goal;
      if (loc && gid && confirm('Удалить цель?')) { loc.goals = (loc.goals ?? []).filter(g => g.id !== gid); persist(); }
      break;
    }
    case 'toggle-pref': {
      const g = loc?.goals?.find(x => x.id === t.closest<HTMLElement>('[data-goal]')?.dataset.goal);
      const x = g?.stops.find(y => y.code === t.dataset.code);
      if (x) { x.pref = x.pref ? undefined : true; persist(); }
      break;
    }
    case 'del-goal-stop': {
      const g = loc?.goals?.find(x => x.id === t.closest<HTMLElement>('[data-goal]')?.dataset.goal);
      if (g) { g.stops = g.stops.filter(x => x.code !== t.dataset.code); persist(); }
      break;
    }
    case 'add-goal-stop': {
      const gid = t.closest<HTMLElement>('[data-goal]')?.dataset.goal;
      const goal = loc?.goals?.find(g => g.id === gid);
      if (loc && goal) await pickGoalStop(loc, goal);
      break;
    }
    case 'del-loc': if (loc && confirm(`Удалить «${loc.name}»?`)) { cfg.locations = cfg.locations.filter(l => l !== loc); persist(); } break;
    case 'del-stop': if (loc && stop) { loc.stops = loc.stops.filter(s => s !== stop); persist(); } break;
    case 'toggle-route': {
      const r = t.dataset.route!;
      if (stop) { stop.routes = stop.routes.includes(r) ? stop.routes.filter(x => x !== r) : [...stop.routes, r]; persist(); }
      break;
    }
    case 'add-stop':
      if (loc) await pickStop(loc);
      break;
    case 'share-link': {
      const url = `${location.origin}${location.pathname}#cfg=${await encodeConfig(cfg)}`;
      if (navigator.share) { try { await navigator.share({ title: 'Sõiduk', url }); break; } catch { /* cancelled – fall through to copy */ } }
      try { await navigator.clipboard.writeText(url); alert('Ссылка скопирована. Откройте её на другом устройстве, чтобы перенести настройки.'); }
      catch { prompt('Скопируйте ссылку:', url); }
      break;
    }
    case 'export-file': {
      const blob = new Blob([JSON.stringify(slim(cfg), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `soiduk-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'import-file': {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.onchange = async () => {
        try { const f = inp.files?.[0]; if (f) await offerImport(sanitize(JSON.parse(await f.text())), 'файла'); }
        catch (err) { alert(`Не удалось прочитать файл: ${err}`); }
      };
      inp.click();
      break;
    }
    case 'restore-prev': {
      const prev = loadPrev();
      if (prev && confirm('Вернуть настройки, которые были до последней загрузки? Текущие станут «предыдущими».')) replaceConfig(prev);
      break;
    }
  }
}
app.addEventListener('click', onClick);
liveEl.addEventListener('click', onClick);

app.addEventListener('input', e => {
  const el = e.target as HTMLInputElement;
  const loc = findLoc(el);
  if (!loc) return;
  if (el.dataset.field === 'goal-name') {
    const g = loc.goals?.find(x => x.id === el.closest<HTMLElement>('[data-goal]')?.dataset.goal);
    if (g) g.name = el.value;
  } else if (el.dataset.field === 'name') loc.name = el.value;
  else {
    const stop = loc.stops.find(s => s.siriId === Number(el.closest<HTMLElement>('[data-stop]')?.dataset.stop));
    if (stop && el.dataset.field === 'label') stop.label = el.value || undefined;
    else if (stop && el.dataset.field === 'stop-walk') stop.walkMin = Math.max(0, Number(el.value) || 0);
  }
  save(cfg);
});

// ---------- live indicator (lives outside #app so animations never restart) ----------
function updateLive() {
  liveEl.hidden = view !== 'dash' || !cfg.locations.length;
  if (liveEl.hidden) return;
  const age = fetchedAt ? Math.floor((Date.now() - fetchedAt) / 1000) : 0;
  liveEl.classList.toggle('loading', loading);
  liveEl.classList.toggle('error', !lastOk);
  liveText.textContent = loading ? 'обновляю…'
    : !lastOk ? `нет связи · данные ${age} с назад`
    : !fetchedAt ? 'загрузка…'
    : age < 3 ? 'данные обновлены' : `обновлено ${age} с назад`;
}

// ---------- loop ----------
setInterval(() => { if (view === 'dash') render(); updateLive(); }, 1000);
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
// fill in position / area / code for stops saved without them (older versions, shared links)
function backfill() {
  loadStops().then(all => {
    const byId = new Map(all.map(x => [x.s, x]));
    let changed = false;
    for (const st of cfg.locations.flatMap(l => l.stops)) {
      const info = byId.get(st.siriId);
      if (info && (st.la === undefined || !st.code)) { Object.assign(st, { code: info.id, la: info.la, lo: info.lo, area: info.ar || undefined, nb: info.nb }); changed = true; }
    }
    if (changed) { save(cfg); clearArrivalCache(); render(); }
  }).catch(() => {});
}
backfill();

// ask the browser not to evict our settings under storage pressure
navigator.storage?.persist?.().catch(() => {});

// opened via a shared link: #cfg=<token>
const shared = new URLSearchParams(location.hash.slice(1)).get('cfg');
if (shared) {
  history.replaceState(null, '', location.pathname + location.search);
  decodeConfig(shared).then(c => offerImport(c, 'ссылки')).catch(err => alert(`Ссылка повреждена: ${err}`));
}

render();
updateLive();
refresh();
