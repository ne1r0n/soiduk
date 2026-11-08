import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTheme } from './theme.ts';

test('resolveTheme: explicit choice wins, auto follows the system', () => {
	assert.equal(resolveTheme('dark', true), 'dark');
	assert.equal(resolveTheme('light', false), 'light');
	assert.equal(resolveTheme('auto', true), 'light');
	assert.equal(resolveTheme('auto', false), 'dark');
});
