import { refresh } from './data.ts';
import { state } from './state.ts';
import { tripOpen } from './tripSheet.ts';

const PULL_PX = 90;

/** Pull the list down from the very top to reload the departures. */
export function initPullToRefresh() {
	let y0: number | null = null;
	let dy = 0;
	const idle = () =>
		state.view !== 'dash' || tripOpen() || !!document.querySelector('#picker:not([hidden])');
	document.addEventListener(
		'touchstart',
		(e) => {
			y0 = window.scrollY <= 0 && e.touches.length === 1 && !idle() ? e.touches[0].clientY : null;
			dy = 0;
		},
		{ passive: true },
	);
	document.addEventListener(
		'touchmove',
		(e) => {
			if (y0 !== null) dy = e.touches[0].clientY - y0;
		},
		{ passive: true },
	);
	document.addEventListener('touchend', () => {
		if (y0 !== null && dy > PULL_PX && window.scrollY <= 0) refresh();
		y0 = null;
	});
}
