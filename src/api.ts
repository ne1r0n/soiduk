export type Mode = 'bus' | 'trol' | 'tram' | 'other';

export interface Departure {
  mode: Mode;
  route: string;
  /** seconds from Tallinn midnight */
  expected: number;
  scheduled: number;
  dest: string;
}

export interface StopDepartures {
  /** server "now" in seconds from Tallinn midnight */
  now: number;
  items: Departure[];
}

const BASE = 'https://transport.tallinn.ee/siri-stop-departures.php';

function toMode(t: string): Mode {
  switch (t.trim().toLowerCase()) {
    case 'bus': return 'bus';
    case 'trol': return 'trol';
    case 'tram': return 'tram';
    default: return 'other';
  }
}

/**
 * Response format:
 *   Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,<now>,version...
 *   stop,<siriId>
 *   bus,33,55048,54954,Kopli,26,Z
 */
export function parseDepartures(text: string): StopDepartures {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = (lines[0] ?? '').split(',');
  const now = Number(header[4]);
  const items: Departure[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    if (f[0] === 'stop' || f.length < 5) continue;
    const expected = Number(f[2]);
    const scheduled = Number(f[3]);
    if (!Number.isFinite(expected) || !Number.isFinite(scheduled)) continue;
    items.push({ mode: toMode(f[0]), route: f[1], expected, scheduled, dest: f[4] });
  }
  if (!Number.isFinite(now)) throw new Error('Unexpected departures format');
  return { now, items };
}

export async function fetchDepartures(siriId: number, signal?: AbortSignal): Promise<StopDepartures> {
  const res = await fetch(`${BASE}?stopid=${siriId}`, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseDepartures(await res.text());
}
