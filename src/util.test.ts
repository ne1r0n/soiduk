import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveItem } from './util.ts';

test('moveItem moves by delta and clamps at the ends', () => {
	assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
	assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
	assert.deepEqual(moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
	assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
	assert.deepEqual(moveItem(['a', 'b', 'c'], -1, 1), ['a', 'b', 'c']);
});

test('moveItem does not mutate the input', () => {
	const src = ['a', 'b'];
	moveItem(src, 0, 1);
	assert.deepEqual(src, ['a', 'b']);
});
