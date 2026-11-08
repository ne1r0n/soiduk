import { type Config, sanitize } from './store.ts';

/**
 * Settings <-> URL-safe token, so they can be backed up or sent to someone as a link.
 * Format: "z." + base64url(deflate-raw(json)), or "j." + base64url(json) when
 * CompressionStream is unavailable.
 */

/** Drop data that is re-derived from stops.json on load (position, area, neighbours) */
export function slim(cfg: Config): Config {
	return {
		locations: cfg.locations.map((l) => ({
			...l,
			stops: l.stops.map(({ la, lo, area, nb, ...keep }) => keep),
		})),
	};
}

const b64 = (b: Uint8Array) =>
	btoa(String.fromCharCode(...b))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
const unb64 = (s: string) =>
	Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(
	bytes: Uint8Array,
	stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
	const w = stream.writable.getWriter();
	w.write(bytes as BufferSource);
	w.close();
	return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export async function encodeConfig(cfg: Config): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(slim(cfg)));
	if (typeof CompressionStream === 'undefined') return 'j.' + b64(bytes);
	return 'z.' + b64(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeConfig(token: string): Promise<Config> {
	const kind = token.slice(0, 2);
	let bytes: Uint8Array = unb64(token.slice(2));
	if (kind === 'z.') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
	else if (kind !== 'j.') throw new Error('Неизвестный формат ссылки');
	return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
}
