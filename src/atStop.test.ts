import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AT_STOP_TTL_MS, isAtStop, toggleAtStop } from './atStop.ts';

const NOW = 1_000_000;

test('toggleAtStop switches one stop on and off, leaving the others alone', () => {
	const on = toggleAtStop({}, 'home:1', NOW);
	assert.deepEqual(on, { 'home:1': NOW + AT_STOP_TTL_MS });
	assert.ok(isAtStop(on, 'home:1', NOW));
	assert.ok(!isAtStop(on, 'home:2', NOW));

	const both = toggleAtStop(on, 'home:2', NOW + 1000);
	assert.ok(isAtStop(both, 'home:1', NOW + 1000));
	assert.ok(isAtStop(both, 'home:2', NOW + 1000));

	const off = toggleAtStop(both, 'home:1', NOW + 2000);
	assert.ok(!isAtStop(off, 'home:1', NOW + 2000));
	assert.ok(isAtStop(off, 'home:2', NOW + 2000));
});

test('at the stop ends by itself', () => {
	const on = toggleAtStop({}, 'home:1', NOW);
	assert.ok(isAtStop(on, 'home:1', NOW + AT_STOP_TTL_MS - 1));
	assert.ok(!isAtStop(on, 'home:1', NOW + AT_STOP_TTL_MS));
});

test('toggleAtStop after it ran out switches on again and drops the stale entries', () => {
	const old = { 'home:1': NOW - 1, 'home:2': NOW - 1 };
	assert.deepEqual(toggleAtStop(old, 'home:1', NOW), { 'home:1': NOW + AT_STOP_TTL_MS });
});
