import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DICT, detectLang, LANGS, plural, setLang } from './i18n.ts';
import type { Key } from './lang/ru.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has the same keys, placeholders and plural forms as Russian', () => {
	for (const l of LANGS) {
		assert.deepEqual(Object.keys(DICT[l]).sort(), Object.keys(DICT.ru).sort(), l);
		for (const [k, master] of Object.entries(DICT.ru)) {
			const v = DICT[l][k as Key];
			assert.ok(v.trim(), `${l}.${k} is empty`);
			assert.deepEqual(placeholders(v), placeholders(master), `${l}.${k} placeholders`);
		}
	}
});

test('plural picks the right word form', () => {
	setLang('ru');
	assert.equal(plural('w.stops', 1), 'остановка');
	assert.equal(plural('w.stops', 3), 'остановки');
	assert.equal(plural('w.stops', 5), 'остановок');
	assert.equal(plural('w.stops', 21), 'остановка');
	setLang('en');
	assert.equal(plural('w.stops', 1), 'stop');
	assert.equal(plural('w.stops', 2), 'stops');
	setLang('et');
	assert.equal(plural('w.goals', 1), 'sihtkoht');
	assert.equal(plural('w.goals', 2), 'sihtkohta');
	setLang('ru');
});

test('detectLang takes the first supported browser language, English otherwise', () => {
	assert.equal(detectLang(['et-EE', 'en']), 'et');
	assert.equal(detectLang(['de', 'ru-RU']), 'ru');
	assert.equal(detectLang(['fr']), 'en');
	assert.equal(detectLang([]), 'en');
});
