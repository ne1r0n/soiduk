import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeConfig, encodeConfig } from './share.ts';
import type { Config } from './store.ts';

const cfg: Config = {
	locations: [
		{
			id: 'home',
			name: 'Дом',
			walkMin: 5,
			stops: [
				{
					siriId: 1127,
					code: '08602-1',
					name: 'Humala',
					walkMin: 9,
					label: 'из города',
					routes: ['41'],
					la: 59.4,
					lo: 24.6,
					area: 'x',
				},
			],
			goals: [
				{ id: 'g', name: 'Rocca al Mare', stops: [{ code: '00140-1', name: 'Mõisa', pref: true }] },
			],
		},
	],
};

test('config survives a share-link round trip (derived fields dropped)', async () => {
	const token = await encodeConfig(cfg);
	assert.match(token, /^[zj]\.[A-Za-z0-9_-]+$/);
	const back = await decodeConfig(token);
	const s = back.locations[0].stops[0];
	assert.equal(s.siriId, 1127);
	assert.equal(s.walkMin, 9);
	assert.equal(s.label, 'из города');
	assert.deepEqual(s.routes, ['41']);
	assert.equal(s.la, undefined);
	assert.deepEqual(back.locations[0].goals?.[0].stops, [
		{ code: '00140-1', name: 'Mõisa', pref: true },
	]);
});

test('garbage token is rejected', async () => {
	await assert.rejects(() => decodeConfig('x.abc'));
});
