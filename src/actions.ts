import { offerImport, replaceConfig } from './backup.ts';
import { refresh } from './data.ts';
import { LANGS, type Lang, setLang, t } from './i18n.ts';
import { updateLive } from './live.ts';
import { closePicker } from './picker.ts';
import { pickGoalStop, pickStop } from './pickers.ts';
import { encodeConfig, slim } from './share.ts';
import { edit, persist, render, state, stopKey } from './state.ts';
import { loadPrev, sanitize, save, saveSelection, uid } from './store.ts';
import { setTheme, type ThemePref } from './theme.ts';
import { openTrip } from './tripSheet.ts';
import { moveItem } from './util.ts';

const findLoc = (el: Element) =>
	state.cfg.locations.find((l) => l.id === el.closest<HTMLElement>('[data-loc]')?.dataset.loc);
const goalIdOf = (el: Element) => el.closest<HTMLElement>('[data-goal]')?.dataset.goal;

async function shareLink() {
	const url = `${location.origin}${location.pathname}#cfg=${await encodeConfig(state.cfg)}`;
	if (navigator.share) {
		try {
			await navigator.share({ title: 'Sõiduk', url });
			return;
		} catch {
			/* cancelled – fall through to copy */
		}
	}
	try {
		await navigator.clipboard.writeText(url);
		alert(t('msg.linkCopied'));
	} catch {
		prompt(t('msg.copyLink'), url);
	}
}

function exportFile() {
	const blob = new Blob([JSON.stringify(slim(state.cfg), null, 2)], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `soiduk-settings-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importFile() {
	const inp = document.createElement('input');
	inp.type = 'file';
	inp.accept = 'application/json,.json';
	inp.onchange = async () => {
		try {
			const f = inp.files?.[0];
			if (f) offerImport(sanitize(JSON.parse(await f.text())), t('msg.fromFile'));
		} catch (err) {
			alert(t('msg.fileFail', { err: String(err) }));
		}
	};
	inp.click();
}

/** ↑ / ↓ in the settings: reorders the location, stop or goal the button belongs to */
function moveEntry(btn: HTMLElement, delta: number) {
	const { cfg } = state;
	const box = btn.closest<HTMLElement>('[data-goal],[data-stop],[data-loc]');
	const loc = findLoc(btn);
	if (!box || !loc) return;
	if (box.dataset.goal) {
		const i = (loc.goals ?? []).findIndex((g) => g.id === box.dataset.goal);
		loc.goals = moveItem(loc.goals ?? [], i, delta);
	} else if (box.dataset.stop) {
		const i = loc.stops.findIndex((s) => s.siriId === Number(box.dataset.stop));
		loc.stops = moveItem(loc.stops, i, delta);
	} else {
		cfg.locations = moveItem(cfg.locations, cfg.locations.indexOf(loc), delta);
	}
	persist();
}

async function onClick(e: MouseEvent) {
	const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
	if (!btn) return;
	const { cfg } = state;
	const loc = findLoc(btn);
	const stopEl = btn.closest<HTMLElement>('[data-stop]');
	const stop = loc?.stops.find((s) => s.siriId === Number(stopEl?.dataset.stop));

	switch (btn.dataset.act) {
		case 'reload':
			refresh();
			break;
		case 'edit':
			state.view = 'edit';
			edit.tab = 'places';
			edit.openLoc = cfg.locations[0]?.id ?? '';
			edit.openStops.clear();
			render();
			updateLive();
			break;
		case 'done':
			state.view = 'dash';
			closePicker();
			render();
			updateLive();
			refresh();
			break;
		case 'add-loc': {
			const id = uid();
			edit.tab = 'places';
			edit.openLoc = id;
			cfg.locations.push({
				id,
				name: cfg.locations.length ? t('def.newLoc') : t('def.home'),
				walkMin: 5,
				stops: [],
				goals: [],
			});
			persist();
			break;
		}
		case 'tab':
			edit.tab = btn.dataset.tab === 'app' ? 'app' : 'places';
			render();
			window.scrollTo(0, 0);
			break;
		case 'toggle-loc':
			if (loc) {
				edit.openLoc = edit.openLoc === loc.id ? '' : loc.id;
				render();
			}
			break;
		case 'toggle-stop':
			if (loc && stop) {
				const key = stopKey(loc.id, stop.siriId);
				if (!edit.openStops.delete(key)) edit.openStops.add(key);
				render();
			}
			break;
		case 'lang': {
			const l = LANGS.find((x) => x === btn.dataset.lang) as Lang | undefined;
			if (l) {
				setLang(l);
				render();
				updateLive();
			}
			break;
		}
		case 'theme':
			setTheme(btn.dataset.themeId as ThemePref);
			render();
			break;
		case 'move-up':
			moveEntry(btn, -1);
			break;
		case 'move-down':
			moveEntry(btn, 1);
			break;
		case 'trip':
			if (loc && btn.dataset.key) openTrip(loc, btn.dataset.key);
			break;
		case 'select-goal':
			if (loc) {
				state.selection[loc.id] = btn.dataset.gid ?? '';
				saveSelection(state.selection);
				render();
			}
			break;
		case 'add-goal':
			if (loc) {
				loc.goals = [...(loc.goals ?? []), { id: uid(), name: t('def.newGoal'), stops: [] }];
				persist();
			}
			break;
		case 'del-goal': {
			const gid = goalIdOf(btn);
			if (loc && gid && confirm(t('msg.delGoal'))) {
				loc.goals = (loc.goals ?? []).filter((g) => g.id !== gid);
				persist();
			}
			break;
		}
		case 'toggle-pref': {
			const g = loc?.goals?.find((x) => x.id === goalIdOf(btn));
			const x = g?.stops.find((y) => y.code === btn.dataset.code);
			if (x) {
				x.pref = x.pref ? undefined : true;
				persist();
			}
			break;
		}
		case 'del-goal-stop': {
			const g = loc?.goals?.find((x) => x.id === goalIdOf(btn));
			if (g) {
				g.stops = g.stops.filter((x) => x.code !== btn.dataset.code);
				persist();
			}
			break;
		}
		case 'add-goal-stop': {
			const goal = loc?.goals?.find((g) => g.id === goalIdOf(btn));
			if (loc && goal) await pickGoalStop(loc, goal);
			break;
		}
		case 'del-loc':
			if (loc && confirm(t('msg.delLoc', { name: loc.name }))) {
				cfg.locations = cfg.locations.filter((l) => l !== loc);
				persist();
			}
			break;
		case 'del-stop':
			if (loc && stop) {
				loc.stops = loc.stops.filter((s) => s !== stop);
				persist();
			}
			break;
		case 'toggle-route': {
			const r = btn.dataset.route;
			if (stop && r) {
				stop.routes = stop.routes.includes(r)
					? stop.routes.filter((x) => x !== r)
					: [...stop.routes, r];
				persist();
			}
			break;
		}
		case 'add-stop':
			if (loc) await pickStop(loc);
			break;
		case 'share-link':
			await shareLink();
			break;
		case 'export-file':
			exportFile();
			break;
		case 'import-file':
			importFile();
			break;
		case 'restore-prev': {
			const prev = loadPrev();
			if (prev && confirm(t('msg.restore'))) replaceConfig(prev);
			break;
		}
	}
}

/** edits in the settings form are saved as you type, without re-rendering (keeps focus) */
function onInput(e: Event) {
	const el = e.target as HTMLInputElement;
	const loc = findLoc(el);
	if (!loc) return;
	if (el.dataset.field === 'goal-name') {
		const g = loc.goals?.find((x) => x.id === goalIdOf(el));
		if (g) g.name = el.value;
	} else if (el.dataset.field === 'name') loc.name = el.value;
	else {
		const stop = loc.stops.find(
			(s) => s.siriId === Number(el.closest<HTMLElement>('[data-stop]')?.dataset.stop),
		);
		if (stop && el.dataset.field === 'label') stop.label = el.value || undefined;
		else if (stop && el.dataset.field === 'stop-walk')
			stop.walkMin = Math.max(0, Number(el.value) || 0);
	}
	save(state.cfg);
}

export function bindActions(app: HTMLElement, live: HTMLElement) {
	app.addEventListener('click', onClick);
	live.addEventListener('click', onClick);
	app.addEventListener('input', onInput);
}
