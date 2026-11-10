// Service worker.
//
// 1. Notifications: a page needs one to show a notification (Android) and to be brought forward on a tap.
//
// 2. A copy of the app on the device, so that it opens without the network and nothing is downloaded twice:
//    - files under assets/ and data/ carry a hash of their content in the name (index-DoC8Y_ky.js,
//      gtfs.1a2b3c4d.json) and never change: once cached, they are served without asking the network;
//    - the few files with fixed names (the page, data.json with the current data file names, the icon) are
//      fetched fresh, and the cached copy is the answer when the network fails or takes too long.
//    The live departures and the map tiles come from other sites and are not touched.

const CACHE = 'soiduk-v1';
/** '/soiduk/' on GitHub Pages: the origin is shared with other sites, so everything is kept to our folder */
const SCOPE = new URL(self.registration.scope).pathname;
/** registered as sw.js?dev by `npm run dev`: there the cache would only get in the way */
const DEV = new URL(self.location.href).searchParams.has('dev');
/** 'assets/index-DoC8Y_ky.js' → ['index', '.js'], 'data/gtfs.1a2b3c4d.json' → ['gtfs', '.json'] */
const HASHED = /^(?:assets|data)\/(.+)[.-][\w-]{8}(\.\w+)$/;
/** a cached page is better than a spinner on a bad connection */
const SLOW_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) =>
	e.waitUntil(
		(async () => {
			for (const name of await caches.keys()) {
				if (name.startsWith('soiduk-') && name !== CACHE) await caches.delete(name);
			}
			await self.clients.claim();
		})(),
	),
);

/** path inside our folder ('assets/index-DoC8Y_ky.js'), or null for anything else */
function ownPath(href) {
	const url = new URL(href);
	if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return null;
	return url.pathname.slice(SCOPE.length);
}

/** which file a hashed name is a version of ('assets/index.js'), or null for a fixed name */
function family(path) {
	const m = HASHED.exec(path);
	return m && `${path.slice(0, path.indexOf('/'))}/${m[1]}${m[2]}`;
}

/** keeps a good answer; a new version of a hashed file replaces the older ones */
async function keep(cache, req, res) {
	if (res.status !== 200 || res.type !== 'basic') return;
	await cache.put(req, res);
	const url = typeof req === 'string' ? req : req.url;
	const fam = family(ownPath(url) ?? '');
	if (!fam) return;
	for (const old of await cache.keys()) {
		if (old.url !== url && family(ownPath(old.url) ?? '') === fam) await cache.delete(old);
	}
}

/** lets the worker live until `work` is done, without delaying the answer to the page */
function meanwhile(e, work) {
	try {
		e.waitUntil(work.catch(() => {}));
	} catch {
		/* the event is over: the work goes on as long as the worker happens to live */
	}
}

async function cacheFirst(e, req) {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	meanwhile(e, keep(cache, req, res.clone()));
	return res;
}

async function networkFirst(e, req) {
	const cache = await caches.open(CACHE);
	// the page is the same whatever the query string says (?source=pwa and the like)
	const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
	const fresh = fetch(req).then((res) => {
		meanwhile(e, keep(cache, req, res.clone()));
		return res;
	});
	if (!cached) return fresh;
	meanwhile(e, fresh); // a late answer still refreshes the copy
	return Promise.race([
		fresh.then(
			(res) => (res.ok ? res : cached),
			() => cached,
		),
		new Promise((done) => setTimeout(() => done(cached), SLOW_MS)),
	]);
}

self.addEventListener('fetch', (e) => {
	const req = e.request;
	if (DEV || req.method !== 'GET') return;
	const path = ownPath(req.url);
	if (path === null || path === 'sw.js') return;
	e.respondWith(
		// whatever goes wrong with the cache itself (no storage, a private window), the network still answers
		(family(path) ? cacheFirst(e, req) : networkFirst(e, req)).catch(() => fetch(req)),
	);
});

// The first visit is served before this worker exists. The page then lists what it has loaded, and the files
// are put aside for the next launch (they come from the browser's own cache, not from the network again).
self.addEventListener('message', (e) => {
	if (DEV || e.data?.type !== 'keep' || !Array.isArray(e.data.urls)) return;
	e.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			for (const href of e.data.urls) {
				try {
					const path = ownPath(href);
					if (path === null || path === 'sw.js' || (await cache.match(href))) continue;
					await keep(cache, href, await fetch(href));
				} catch {
					/* not this time */
				}
			}
		})(),
	);
});

self.addEventListener('notificationclick', (e) => {
	e.notification.close();
	e.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((list) => (list.length ? list[0].focus() : self.clients.openWindow('./'))),
	);
});
