import { KOFI_URL } from './config.ts';
import { stopInfo } from './gtfs.ts';
import type { GoalCfg, LocationCfg, StopCfg } from './plan.ts';
import { edit, knownRoutes, state, stopKey } from './state.ts';
import { loadPrev } from './store.ts';
import { loadTheme, THEMES } from './theme.ts';
import { esc, routeSort } from './util.ts';

/** ↑ ↓ buttons; the container (location, stop or goal) is found from the DOM on click */
function moveButtons(index: number, count: number): string {
	return `<span class="moves"><button type="button" class="icon move" data-act="move-up" aria-label="Выше" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon move" data-act="move-down" aria-label="Ниже" ${index === count - 1 ? 'disabled' : ''}>↓</button></span>`;
}

function goalEditor(g: GoalCfg, index: number, count: number): string {
	return `
    <div class="stop" data-goal="${g.id}">
      <div class="stop-head">
        <input class="name" data-field="goal-name" value="${esc(g.name)}" placeholder="Название цели" />
        ${moveButtons(index, count)}
        <button class="icon danger" data-act="del-goal" aria-label="Удалить цель">✕</button>
      </div>
      <div class="chips">
        ${
					g.stops
						.map(
							(x) => `<span class="chip on goal-stop ${x.pref ? 'pref' : ''}">
          <button class="x star" data-act="toggle-pref" data-code="${esc(x.code)}" aria-label="Предпочтительная" title="Предпочтительная остановка">${x.pref ? '★' : '☆'}</button>
          ${esc(x.name)} <small>${esc(x.code)}</small>
          <button class="x" data-act="del-goal-stop" data-code="${esc(x.code)}" aria-label="Убрать">✕</button></span>`,
						)
						.join('') || '<span class="muted">остановок нет</span>'
				}
      </div>
      <div class="hint muted">Показываем рейсы, которые доедут до одной из этих остановок, и время прибытия. ★ — предпочтительная: если рейс едет и до неё, покажем прибытие на неё, а не на более раннюю.</div>
      <button class="btn ghost" data-act="add-goal-stop">＋ Остановки у цели</button>
    </div>`;
}

const CHEVRON = '<span class="chev" aria-hidden="true">▸</span>';

/** one-line summary of a collapsed stop */
function stopSummary(s: StopCfg): string {
	const parts = [s.label, s.routes.length ? s.routes.join(', ') : 'все маршруты'].filter(Boolean);
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
        <button class="icon danger" data-act="del-stop" aria-label="Удалить остановку">✕</button></div>
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
			? '<span class="warn">Нет онлайн-данных: у остановки нет рейсов в прогнозе (возможно, пригородная или не обслуживается сейчас)</span>'
			: '<span class="muted">маршруты загружаются…</span>';
	const dests = info.dests;
	const where = s.area ?? '';
	const map =
		s.la && s.lo
			? `<a class="maplink" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${s.la}&mlon=${s.lo}#map=18/${s.la}/${s.lo}">🗺 карта</a>`
			: '';
	return `
    <div class="stop" data-stop="${s.siriId}">
      <div class="stop-head">
        <button type="button" class="fold" data-act="toggle-stop" aria-expanded="true">${CHEVRON}<span class="fold-main inline"><b>${esc(s.name)}</b> <span class="muted">#${s.siriId}</span></span></button>
        ${moveButtons(index, count)}
        <button class="icon danger" data-act="del-stop" aria-label="Удалить остановку">✕</button></div>
      ${dests.length ? `<div class="dirs">→ ${dests.slice(0, 4).map(esc).join(' · ')}</div>` : ''}
      <label class="walk-edit">🚶 Пешком до этой остановки, мин
        <input type="number" min="0" max="60" inputmode="numeric" data-field="stop-walk" value="${s.walkMin ?? 5}" />
      </label>
      ${where || map ? `<div class="where muted">${esc(where)} ${map}</div>` : ''}
      <div class="chips">${chips}</div>
      ${info.planned && routes.length ? '<div class="hint muted">Онлайн-данных нет – маршруты по расписанию</div>' : ''}
      <div class="hint muted">${s.routes.length ? 'Только выбранные маршруты' : 'Все маршруты – выберите нужные'}</div>
      <input class="dest-in" data-field="label" value="${esc(s.label ?? '')}" placeholder="Пометка на карточке (например, «в центр»)" />
    </div>`;
}

/** summary of a collapsed location: «3 остановки · 2 цели» */
function locSummary(l: LocationCfg): string {
	const n = l.stops.length;
	const g = l.goals?.length ?? 0;
	const stops = n === 1 ? 'остановка' : n >= 2 && n <= 4 ? 'остановки' : 'остановок';
	const goals = g === 1 ? 'цель' : g >= 2 && g <= 4 ? 'цели' : 'целей';
	return `${n} ${stops} · ${g} ${goals}`;
}

function locationEditor(l: LocationCfg, li: number, all: LocationCfg[]): string {
	if (edit.openLoc !== l.id)
		return `
    <section class="card edit folded" data-loc="${l.id}">
      <header>
        <button type="button" class="fold" data-act="toggle-loc" aria-expanded="false">${CHEVRON}<span class="fold-main"><b>${esc(l.name) || 'Без названия'}</b><small class="muted">${locSummary(l)}</small></span></button>
        ${moveButtons(li, all.length)}
        <button class="icon danger" data-act="del-loc" aria-label="Удалить локацию">🗑</button>
      </header>
    </section>`;
	return `
    <section class="card edit" data-loc="${l.id}">
      <header>
        <button type="button" class="fold chev-only" data-act="toggle-loc" aria-expanded="true" aria-label="Свернуть">${CHEVRON}</button>
        <input class="name" data-field="name" value="${esc(l.name)}" placeholder="Название (Дом, Работа…)" />
        ${moveButtons(li, all.length)}
        <button class="icon danger" data-act="del-loc" aria-label="Удалить локацию">🗑</button>
      </header>
      <div class="sec-title">Остановки рядом</div>
      ${l.stops.map((s, i) => stopEditor(l, s, i, l.stops.length)).join('')}
      <button class="btn ghost" data-act="add-stop">＋ Остановка</button>
      <div class="sec-title">Куда еду</div>
      ${(l.goals ?? []).map((g, i, gs) => goalEditor(g, i, gs.length)).join('')}
      <button class="btn ghost" data-act="add-goal">＋ Цель (например, торговый центр)</button>
    </section>`;
}

function placesTab(): string {
	const locs = state.cfg.locations.map(locationEditor).join('');
	return `
      ${locs || '<p class="muted">Добавьте первую локацию – например «Дом» – и выберите остановки рядом.</p>'}
      <button class="btn primary" data-act="add-loc">＋ Локация</button>`;
}

function appTab(): string {
	const theme = loadTheme();
	return `
      <div class="sec-title first">Оформление</div>
      <div class="goalbar">
        ${THEMES.map((t) => `<button type="button" class="gchip ${t.id === theme ? 'on' : ''}" data-act="theme" data-theme-id="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="sec-title">Резервная копия</div>
      <div class="io">
        <button class="btn" data-act="share-link">🔗 Поделиться</button>
        <button class="btn" data-act="export-file">⬇ Экспорт</button>
        <button class="btn" data-act="import-file">⬆ Импорт</button>
      </div>
      ${loadPrev() ? '<button class="btn ghost" data-act="restore-prev">↩ Вернуть настройки, которые были до последнего импорта</button>' : ''}
      <p class="hint muted">Настройки хранятся только в этом браузере. «Поделиться» создаёт ссылку со всеми настройками: откройте её на другом устройстве или отправьте другу.</p>
      <footer class="about">
        ${KOFI_URL ? `<a class="kofi" href="${esc(KOFI_URL)}" target="_blank" rel="noopener">☕ Поддержать на Ko-fi</a>` : ''}
        <p class="muted">Данные: <a href="https://transport.tallinn.ee" target="_blank" rel="noopener">transport.tallinn.ee</a> · Карта © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>
        <p class="muted version">Sõiduk v${__APP_VERSION__} · <a href="https://github.com/ne1r0n/soiduk" target="_blank" rel="noopener">GitHub</a> · сборка ${__APP_COMMIT__}, ${__APP_BUILT__}</p>
      </footer>`;
}

const TABS = [
	{ id: 'places', label: 'Места' },
	{ id: 'app', label: 'Приложение' },
] as const;

export function editor(): string {
	return `
    <div class="edit-bar">
      <div class="top"><h1>Настройки</h1>
        <div class="actions"><button class="btn" data-act="done">Готово</button></div></div>
      <div class="goalbar tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" role="tab" aria-selected="${edit.tab === t.id}" class="gchip ${edit.tab === t.id ? 'on' : ''}" data-act="tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
    </div>
    <main>${edit.tab === 'places' ? placesTab() : appTab()}
    </main>
`;
}
