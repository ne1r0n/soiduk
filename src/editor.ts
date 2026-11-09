import { APP_URL, KOFI_URL } from './config.ts';
import { stopInfo } from './gtfs.ts';
import { getLang, LANG_NAMES, LANGS, plural, t } from './i18n.ts';
import type { GoalCfg, LocationCfg, StopCfg } from './plan.ts';
import qrSvg from './qr.svg?raw';
import { edit, knownRoutes, state, stopKey } from './state.ts';
import { loadPrev } from './store.ts';
import { loadTheme, THEMES } from './theme.ts';
import { esc, routeSort } from './util.ts';

/** ↑ ↓ buttons; the container (location, stop or goal) is found from the DOM on click */
function moveButtons(index: number, count: number): string {
	return `<span class="moves"><button type="button" class="icon move" data-act="move-up" aria-label="${t('ed.up')}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon move" data-act="move-down" aria-label="${t('ed.down')}" ${index === count - 1 ? 'disabled' : ''}>↓</button></span>`;
}

function goalEditor(g: GoalCfg, index: number, count: number): string {
	return `
    <div class="stop" data-goal="${g.id}">
      <div class="stop-head">
        <input class="name" data-field="goal-name" value="${esc(g.name)}" placeholder="${t('ed.goalName')}" />
        ${moveButtons(index, count)}
        <button class="icon danger" data-act="del-goal" aria-label="${t('ed.delGoal')}">✕</button>
      </div>
      <div class="chips">
        ${
					g.stops
						.map(
							(x) => `<span class="chip on goal-stop ${x.pref ? 'pref' : ''}">
          <button class="x star" data-act="toggle-pref" data-code="${esc(x.code)}" aria-label="${t('ed.pref')}" title="${t('ed.prefTitle')}">${x.pref ? '★' : '☆'}</button>
          ${esc(x.name)} <small>${esc(x.code)}</small>
          <button class="x" data-act="del-goal-stop" data-code="${esc(x.code)}" aria-label="${t('ed.remove')}">✕</button></span>`,
						)
						.join('') || `<span class="muted">${t('ed.noStops')}</span>`
				}
      </div>
      <div class="hint muted">${t('ed.goalHint')}</div>
      <button class="btn ghost" data-act="add-goal-stop">${t('ed.addGoalStop')}</button>
    </div>`;
}

const CHEVRON = '<span class="chev" aria-hidden="true">▸</span>';

/** one-line summary of a collapsed stop */
function stopSummary(s: StopCfg): string {
	const parts = [s.label, s.routes.length ? s.routes.join(', ') : t('ed.allRoutes')].filter(
		Boolean,
	);
	return esc(parts.join(' · '));
}

function stopEditor(loc: LocationCfg, s: StopCfg, index: number, count: number): string {
	const open = edit.openStops.has(stopKey(loc.id, s.siriId));
	if (!open)
		return `
    <div class="stop folded" data-stop="${s.siriId}">
      <div class="stop-head">
        <button type="button" class="fold" data-act="toggle-stop" aria-expanded="false">${CHEVRON}<span class="fold-main"><b>${esc(s.name)}</b><small class="muted">${stopSummary(s)}</small></span></button>
        ${moveButtons(index, count)}
        <button class="icon danger" data-act="del-stop" aria-label="${t('ed.delStop')}">✕</button></div>
    </div>`;
	const info = stopInfo(s);
	const routes = [...new Set([...info.routes, ...s.routes])].sort(routeSort);
	const chips = routes.length
		? routes
				.map(
					(r) =>
						`<button class="chip ${s.routes.includes(r) ? 'on' : ''}" data-act="toggle-route" data-route="${esc(r)}">${esc(r)}</button>`,
				)
				.join('')
		: knownRoutes.has(s.siriId)
			? `<span class="warn">${t('ed.noForecast')}</span>`
			: `<span class="muted">${t('ed.routesLoading')}</span>`;
	const dests = info.dests;
	const where = s.area ?? '';
	const map =
		s.la && s.lo
			? `<a class="maplink" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${s.la}&mlon=${s.lo}#map=18/${s.la}/${s.lo}">${t('ed.map')}</a>`
			: '';
	return `
    <div class="stop" data-stop="${s.siriId}">
      <div class="stop-head">
        <button type="button" class="fold" data-act="toggle-stop" aria-expanded="true">${CHEVRON}<span class="fold-main inline"><b>${esc(s.name)}</b> <span class="muted">#${s.siriId}</span></span></button>
        ${moveButtons(index, count)}
        <button class="icon danger" data-act="del-stop" aria-label="${t('ed.delStop')}">✕</button></div>
      ${dests.length ? `<div class="dirs">→ ${dests.slice(0, 4).map(esc).join(' · ')}</div>` : ''}
      <label class="walk-edit">${t('ed.walk')}
        <input type="number" min="0" max="60" inputmode="numeric" data-field="stop-walk" value="${s.walkMin ?? 5}" />
      </label>
      ${where || map ? `<div class="where muted">${esc(where)} ${map}</div>` : ''}
      <div class="chips">${chips}</div>
      ${info.planned && routes.length ? `<div class="hint muted">${t('ed.planRoutes')}</div>` : ''}
      <div class="hint muted">${s.routes.length ? t('ed.onlySelected') : t('ed.pickRoutes')}</div>
      <input class="dest-in" data-field="label" value="${esc(s.label ?? '')}" placeholder="${t('ed.labelPh')}" />
    </div>`;
}

/** summary of a collapsed location: «3 остановки · 2 цели» */
function locSummary(l: LocationCfg): string {
	const n = l.stops.length;
	const g = l.goals?.length ?? 0;
	return `${n} ${plural('w.stops', n)} · ${g} ${plural('w.goals', g)}`;
}

function locationEditor(l: LocationCfg, li: number, all: LocationCfg[]): string {
	if (edit.openLoc !== l.id)
		return `
    <section class="card edit folded" data-loc="${l.id}">
      <header>
        <button type="button" class="fold" data-act="toggle-loc" aria-expanded="false">${CHEVRON}<span class="fold-main"><b>${esc(l.name) || t('ed.untitled')}</b><small class="muted">${locSummary(l)}</small></span></button>
        ${moveButtons(li, all.length)}
        <button class="icon danger" data-act="del-loc" aria-label="${t('ed.delLoc')}">🗑</button>
      </header>
    </section>`;
	return `
    <section class="card edit" data-loc="${l.id}">
      <header>
        <button type="button" class="fold chev-only" data-act="toggle-loc" aria-expanded="true" aria-label="${t('ed.collapse')}">${CHEVRON}</button>
        <input class="name" data-field="name" value="${esc(l.name)}" placeholder="${t('ed.locName')}" />
        ${moveButtons(li, all.length)}
        <button class="icon danger" data-act="del-loc" aria-label="${t('ed.delLoc')}">🗑</button>
      </header>
      <div class="sec-title">${t('ed.nearby')}</div>
      ${l.stops.map((s, i) => stopEditor(l, s, i, l.stops.length)).join('')}
      <button class="btn ghost" data-act="add-stop">${t('ed.addStop')}</button>
      <div class="sec-title">${t('ed.goals')}</div>
      ${(l.goals ?? []).map((g, i, gs) => goalEditor(g, i, gs.length)).join('')}
      <button class="btn ghost" data-act="add-goal">${t('ed.addGoal')}</button>
    </section>`;
}

function placesTab(): string {
	const locs = state.cfg.locations.map(locationEditor).join('');
	return `
      ${locs || `<p class="muted">${t('ed.empty')}</p>`}
      <button class="btn primary" data-act="add-loc">${t('ed.addLoc')}</button>`;
}

function appTab(): string {
	const theme = loadTheme();
	return `
      <div class="sec-title first">${t('ed.language')}</div>
      <div class="goalbar">
        ${LANGS.map((l) => `<button type="button" class="gchip ${l === getLang() ? 'on' : ''}" data-act="lang" data-lang="${l}">${LANG_NAMES[l]}</button>`).join('')}
      </div>
      <div class="sec-title">${t('ed.appearance')}</div>
      <div class="goalbar">
        ${THEMES.map((th) => `<button type="button" class="gchip ${th.id === theme ? 'on' : ''}" data-act="theme" data-theme-id="${th.id}">${t(th.label)}</button>`).join('')}
      </div>
      <div class="sec-title">${t('ed.backup')}</div>
      <div class="io">
        <button class="btn" data-act="share-link">${t('ed.share')}</button>
        <button class="btn" data-act="export-file">${t('ed.export')}</button>
        <button class="btn" data-act="import-file">${t('ed.import')}</button>
      </div>
      ${loadPrev() ? `<button class="btn ghost" data-act="restore-prev">${t('ed.restore')}</button>` : ''}
      <p class="hint muted">${t('ed.backupHint')}</p>
      <div class="sec-title">${t('ed.qr')}</div>
      <div class="qr">
        <div class="qr-box" role="img" aria-label="${esc(APP_URL)}">${qrSvg}</div>
        <p class="muted">${t('ed.qrHint')}</p>
      </div>
      <footer class="about">
        ${KOFI_URL ? `<a class="kofi" href="${esc(KOFI_URL)}" target="_blank" rel="noopener">${t('ed.kofi')}</a>` : ''}
        <p class="muted">${t('ed.data')} <a href="https://transport.tallinn.ee" target="_blank" rel="noopener">transport.tallinn.ee</a> · ${t('ed.mapBy')} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>
        <p class="muted version">Sõiduk v${__APP_VERSION__} · <a href="https://github.com/ne1r0n/soiduk" target="_blank" rel="noopener">GitHub</a> · ${t('ed.build')} ${__APP_COMMIT__}, ${__APP_BUILT__}</p>
      </footer>`;
}

const TABS = [
	{ id: 'places', label: 'tab.places' },
	{ id: 'app', label: 'tab.app' },
] as const;

export function editor(): string {
	return `
    <div class="edit-bar">
      <div class="top"><h1>${t('app.settings')}</h1>
        <div class="actions"><button type="button" class="icon plain" data-act="done" aria-label="${t('app.done')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div></div>
      <div class="goalbar tabs" role="tablist">
        ${TABS.map((tab) => `<button type="button" role="tab" aria-selected="${edit.tab === tab.id}" class="gchip ${edit.tab === tab.id ? 'on' : ''}" data-act="tab" data-tab="${tab.id}">${t(tab.label)}</button>`).join('')}
      </div>
    </div>
    <main>${edit.tab === 'places' ? placesTab() : appTab()}
    </main>
`;
}
