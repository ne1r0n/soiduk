import { refresh } from './data.ts';
import { t } from './i18n.ts';
import { updateLive } from './live.ts';
import { pickStop } from './pickers.ts';
import type { LocationCfg } from './plan.ts';
import { edit, persist, render, state } from './state.ts';
import type { StopInfo } from './stops.ts';
import { loadStops } from './stops.ts';
import { setDemo, uid } from './store.ts';
import { stopOverview } from './trip.ts';
import { esc, routeSort } from './util.ts';

/**
 * First launch, no places yet: find a stop (by position, by name or on the map), say how long it takes to walk
 * there, done. The position only speeds up the first step – every step also works without it.
 */
const wiz = {
	step: 'start' as 'start' | 'walk',
	stop: undefined as StopInfo | undefined,
	walkMin: 5,
	busy: false,
	err: '' as '' | 'ob.geoFail' | 'ob.far' | 'ob.demoFail',
};

const WALK_PRESETS = [2, 5, 10, 15];
const GEO_TIMEOUT_MS = 8000;

/** a throwaway place for the picker: the real one is created at the last step */
const draft = (): LocationCfg => ({ id: 'draft', name: '', walkMin: wiz.walkMin, stops: [] });

function onPicked(s: StopInfo) {
	wiz.stop = s;
	wiz.step = 'walk';
	wiz.err = '';
	render();
	window.scrollTo(0, 0);
}

function locate(): Promise<{ la: number; lo: number }> {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) return reject(new Error('no geolocation'));
		navigator.geolocation.getCurrentPosition(
			(p) => resolve({ la: p.coords.latitude, lo: p.coords.longitude }),
			reject,
			{ enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS },
		);
	});
}

export async function wizLocate() {
	if (wiz.busy) return;
	wiz.busy = true;
	wiz.err = '';
	render();
	try {
		const near = await locate();
		if (!(await pickStop(draft(), { near, onPick: onPicked }))) wiz.err = 'ob.far';
	} catch {
		wiz.err = 'ob.geoFail';
	}
	wiz.busy = false;
	render();
}

export async function wizSearch() {
	await pickStop(draft(), { onPick: onPicked });
}

/** a stop with several lines, one goal reached directly and one that takes a change (or a short walk) */
const DEMO = { home: '07906-1', goals: [['02808-1', '02906-1'], ['03205-1']] };

/** shows a ready place with live data; nothing of it is saved */
export async function wizDemo() {
	if (wiz.busy) return;
	const all = await loadStops().catch(() => []);
	const byCode = new Map(all.map((s) => [s.id, s]));
	const home = byCode.get(DEMO.home);
	if (!home) {
		wiz.err = 'ob.demoFail';
		return render();
	}
	const goals = DEMO.goals
		.map((codes) => codes.map((c) => byCode.get(c)).filter((s): s is StopInfo => !!s))
		.filter((g) => g.length)
		.map((g, i) => ({
			id: `demo${i}`,
			name: g[0].n,
			stops: g.map((s) => ({ code: s.id, name: s.n })),
		}));
	setDemo(true);
	state.cfg = {
		locations: [
			{
				id: 'demo',
				name: t('demo.name'),
				walkMin: 5,
				stops: [
					{
						siriId: home.s,
						code: home.id,
						name: home.n,
						walkMin: 5,
						routes: [],
						la: home.la,
						lo: home.lo,
						area: home.ar || undefined,
						nb: home.nb,
					},
				],
				goals,
			},
		],
	};
	state.view = 'dash';
	render();
	updateLive();
	refresh();
}

/** leaves the demo for the real first step */
export function wizLeaveDemo() {
	setDemo(false);
	state.cfg = { locations: [] };
	state.view = 'start';
	wiz.step = 'start';
	render();
	updateLive();
}

export function wizBack() {
	wiz.step = 'start';
	render();
}

export function wizWalk(min: number) {
	wiz.walkMin = Math.min(60, Math.max(0, min));
	render();
}

export function wizDone() {
	const s = wiz.stop;
	if (!s) return;
	const loc: LocationCfg = {
		id: uid(),
		name: t('def.home'),
		walkMin: wiz.walkMin,
		stops: [
			{
				siriId: s.s,
				code: s.id,
				name: s.n,
				walkMin: wiz.walkMin,
				routes: [],
				la: s.la,
				lo: s.lo,
				area: s.ar || undefined,
				nb: s.nb,
			},
		],
		goals: [],
	};
	state.cfg.locations.push(loc);
	edit.openLoc = loc.id;
	state.view = 'dash';
	wiz.step = 'start';
	wiz.stop = undefined;
	persist();
	updateLive();
	refresh();
}

function startStep(): string {
	return `
    <h1>${t('ob.title')}</h1>
    <p class="muted">${t('ob.lead')}</p>
    <div class="ob-actions">
      <button type="button" class="btn primary" data-act="wiz-locate" ${wiz.busy ? 'disabled' : ''}>${wiz.busy ? t('ob.locating') : t('ob.locate')}</button>
      <button type="button" class="btn" data-act="wiz-search" ${wiz.busy ? 'disabled' : ''}>${t('ob.search')}</button>
      <button type="button" class="btn ghost" data-act="wiz-demo" ${wiz.busy ? 'disabled' : ''}>${t('ob.demo')}</button>
    </div>
    ${wiz.err ? `<p class="ob-err">${t(wiz.err)}</p>` : ''}
    <button type="button" class="linkish" data-act="import-file">${t('ob.import')}</button>`;
}

function walkStep(s: StopInfo): string {
	const routes = state.gtfs ? stopOverview(state.gtfs, s.id).routes.sort(routeSort) : [];
	const chips = WALK_PRESETS.map(
		(m) =>
			`<button type="button" class="gchip ${m === wiz.walkMin ? 'on' : ''}" data-act="wiz-walk" data-min="${m}">${m}</button>`,
	).join('');
	return `
    <h1>${t('ob.walkTitle')}</h1>
    <section class="card ob-stop">
      <b>${esc(s.n)}</b>
      <span class="muted">${esc(s.ar)}</span>
      ${routes.length ? `<span class="muted">${t('pk.routes')}${routes.slice(0, 8).map(esc).join(' · ')}</span>` : ''}
    </section>
    <p class="muted">${t('ob.walkLead')}</p>
    <div class="ob-walk">
      <button type="button" class="icon" data-act="wiz-walk" data-min="${wiz.walkMin - 1}" aria-label="−">−</button>
      <output><b>${wiz.walkMin}</b> ${t('unit.min')}</output>
      <button type="button" class="icon" data-act="wiz-walk" data-min="${wiz.walkMin + 1}" aria-label="+">+</button>
    </div>
    <div class="goalbar ob-presets">${chips}</div>
    <div class="ob-actions">
      <button type="button" class="btn primary" data-act="wiz-done">${t('ob.finish')}</button>
      <button type="button" class="btn ghost" data-act="wiz-back">${t('ob.back')}</button>
    </div>`;
}

export function onboarding(): string {
	return `<main class="welcome onboard">${wiz.step === 'walk' && wiz.stop ? walkStep(wiz.stop) : startStep()}</main>`;
}
