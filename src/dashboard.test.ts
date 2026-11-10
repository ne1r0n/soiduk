import assert from 'node:assert/strict';
import { beforeEach, type TestContext, test } from 'node:test';
import { dashboard, tickDashboard } from './dashboard.ts';
import { state } from './state.ts';

const NOW = Date.parse('2026-11-10T10:00:00Z');
beforeEach((context) => {
	const t = context as TestContext;
	t.mock.timers.enable({ apis: ['Date'], now: NOW });
	state.cfg = {
		locations: [
			{
				id: 'home',
				name: 'Home',
				walkMin: 0,
				stops: [{ siriId: 1, code: 'A', name: 'A', label: 'To town', routes: [] }],
			},
		],
	};
	state.data = new Map([
		[
			1,
			{
				now: 43200,
				items: [{ mode: 'bus', route: '1', dest: 'G', expected: 43501, scheduled: 43501 }],
			},
		],
	]);
	state.fetchedAt = NOW;
	state.failed = new Set();
	state.planned = new Set();
	state.atStop = {};
	state.watch = null;
	state.selection = {};
});

/** Only what the clock touches. Keeping these objects shows whether a countdown is rewritten or replaced. */
function clockDom(html: string) {
	let writes = 0;
	const els = [...html.matchAll(/data-t="(\w+)"/g)].map((m) => {
		let text = '';
		const classes = new Set<string>();
		return {
			dataset: { t: m[1] },
			classes,
			classList: {
				toggle: (key: string, on: boolean) => (on ? classes.add(key) : classes.delete(key)),
			},
			get textContent() {
				return text;
			},
			set textContent(value: string) {
				writes++;
				text = value;
			},
		};
	});
	const root = { querySelectorAll: () => els } as unknown as HTMLElement;
	return { root, card: els[0], rows: els.slice(1), writes: () => writes };
}

test('the clock writes the countdown and the colour of the card, and only when they change', () => {
	const dom = clockDom(dashboard());
	assert.deepEqual([dom.card.dataset.t, dom.rows[0].dataset.t], ['card', 'walk']);
	assert.equal(tickDashboard(dom.root, NOW), false);
	assert.equal(dom.rows[0].textContent, 'выйти через 5 мин');
	assert.deepEqual([...dom.card.classes], ['ok']);
	assert.equal(tickDashboard(dom.root, NOW + 500), false);
	assert.equal(dom.writes(), 1, 'the same text is not written again');
	assert.equal(tickDashboard(dom.root, NOW + 2000), false);
	assert.equal(dom.rows[0].textContent, 'выйти через 4 мин');
	assert.equal(dom.writes(), 2);
	assert.deepEqual([...dom.card.classes], ['soon']);
	assert.equal(tickDashboard(dom.root, NOW + 242_000), false);
	assert.equal(dom.rows[0].textContent, 'выйти сейчас');
	assert.deepEqual([...dom.card.classes], ['now']);
});

test('fresh data that says the same gives the same HTML: nothing on the page is replaced', (t) => {
	const before = dashboard();
	assert.ok(
		!/мин|сейчас/.test(before.slice(before.indexOf('<ul'))),
		'no countdown text in the HTML',
	);
	t.mock.timers.tick(20_000);
	// the feed answered again: the same departure, the server clock 20 s on
	state.data = new Map([[1, { now: 43220, items: state.data.get(1)!.items }]]);
	state.fetchedAt = NOW + 20_000;
	const after = dashboard();
	assert.equal(after, before);
	const dom = clockDom(after);
	tickDashboard(dom.root);
	assert.equal(dom.rows[0].textContent, 'выйти через 4 мин', 'while the countdown has moved on');
});

test('the rows are built anew only when a trip can no longer be caught', (t) => {
	const dom = clockDom(dashboard());
	assert.equal(tickDashboard(dom.root, NOW + 331_000), false);
	assert.equal(tickDashboard(dom.root, NOW + 331_001), true);
	t.mock.timers.tick(331_001);
	assert.ok(!dashboard().includes('data-t='));
});

test('the rows are built anew when «at the stop» runs out, and the walking time counts again', (t) => {
	state.cfg.locations[0].stops[0].walkMin = 5;
	state.atStop = { 'home:1': NOW + 10_000 };
	const dom = clockDom(dashboard());
	tickDashboard(dom.root, NOW);
	assert.equal(dom.rows[0].dataset.t, 'stop');
	assert.equal(dom.rows[0].textContent, 'через 5 мин');
	assert.equal(tickDashboard(dom.root, NOW + 9999), false);
	assert.equal(tickDashboard(dom.root, NOW + 10_000), true);
	t.mock.timers.tick(10_000);
	const updated = clockDom(dashboard());
	tickDashboard(updated.root);
	assert.equal(updated.rows[0].dataset.t, 'walk');
	assert.equal(updated.rows[0].textContent, 'выйти сейчас');
});
