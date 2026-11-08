import { offerImport, replaceConfig } from './backup.ts';
import { refresh } from './data.ts';
import { updateLive } from './live.ts';
import { toggleWatch } from './notify.ts';
import { closePicker } from './picker.ts';
import { pickGoalStop, pickStop } from './pickers.ts';
import { encodeConfig, slim } from './share.ts';
import { persist, render, state } from './state.ts';
import { loadPrev, sanitize, save, saveSelection, uid } from './store.ts';

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
		alert('Ссылка скопирована. Откройте её на другом устройстве, чтобы перенести настройки.');
	} catch {
		prompt('Скопируйте ссылку:', url);
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
			if (f) offerImport(sanitize(JSON.parse(await f.text())), 'файла');
		} catch (err) {
			alert(`Не удалось прочитать файл: ${err}`);
		}
	};
	inp.click();
}

async function onClick(e: MouseEvent) {
	const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
	if (!t) return;
	const { cfg } = state;
	const loc = findLoc(t);
	const stopEl = t.closest<HTMLElement>('[data-stop]');
	const stop = loc?.stops.find((s) => s.siriId === Number(stopEl?.dataset.stop));

	switch (t.dataset.act) {
		case 'reload':
			refresh();
			break;
		case 'edit':
			state.view = 'edit';
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
		case 'add-loc':
			cfg.locations.push({
				id: uid(),
				name: cfg.locations.length ? 'Новая локация' : 'Дом',
				walkMin: 5,
				stops: [],
				goals: [],
			});
			persist();
			break;
		case 'watch':
			if (loc) toggleWatch(loc, undefined);
			break;
		case 'pin':
			if (loc) toggleWatch(loc, t.dataset.key);
			break;
		case 'select-goal':
			if (loc) {
				state.selection[loc.id] = t.dataset.gid ?? '';
				saveSelection(state.selection);
				render();
			}
			break;
		case 'add-goal':
			if (loc) {
				loc.goals = [...(loc.goals ?? []), { id: uid(), name: 'Новая цель', stops: [] }];
				persist();
			}
			break;
		case 'del-goal': {
			const gid = goalIdOf(t);
			if (loc && gid && confirm('Удалить цель?')) {
				loc.goals = (loc.goals ?? []).filter((g) => g.id !== gid);
				persist();
			}
			break;
		}
		case 'toggle-pref': {
			const g = loc?.goals?.find((x) => x.id === goalIdOf(t));
			const x = g?.stops.find((y) => y.code === t.dataset.code);
			if (x) {
				x.pref = x.pref ? undefined : true;
				persist();
			}
			break;
		}
		case 'del-goal-stop': {
			const g = loc?.goals?.find((x) => x.id === goalIdOf(t));
			if (g) {
				g.stops = g.stops.filter((x) => x.code !== t.dataset.code);
				persist();
			}
			break;
		}
		case 'add-goal-stop': {
			const goal = loc?.goals?.find((g) => g.id === goalIdOf(t));
			if (loc && goal) await pickGoalStop(loc, goal);
			break;
		}
		case 'del-loc':
			if (loc && confirm(`Удалить «${loc.name}»?`)) {
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
			const r = t.dataset.route;
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
			if (
				prev &&
				confirm(
					'Вернуть настройки, которые были до последнего импорта? Текущие станут «предыдущими».',
				)
			)
				replaceConfig(prev);
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
