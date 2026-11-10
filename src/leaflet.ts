/**
 * Leaflet with its stylesheet. Only the stop picker and the trip sheet draw a map, so this module is not
 * part of the start-up script: it is fetched the first time a map is opened (see maps.ts).
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** a map with the plain OSM tiles (no API key); the dark look comes from a CSS filter on .leaflet-tile-pane */
export function tileMap(el: HTMLElement | string): L.Map {
	const map = L.map(el, { zoomControl: false, attributionControl: true });
	L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
		maxZoom: 19,
		attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
	}).addTo(map);
	return map;
}

export { L };
