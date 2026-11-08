import { fmtClock, fmtMinutes, type Row } from './plan.ts';

/** "Follow this goal": a notification that tracks the next catchable departure */
export interface Watch {
  locId: string;
  goalId: string;
  /** pinned departure (see rowKey); absent = always the nearest catchable one */
  pin?: string;
  /** ms timestamp after which tracking stops by itself */
  until: number;
}

export const WATCH_TTL_MS = 90 * 60_000;
const KEY = 'soiduk.watch.v1';

export const rowKey = (r: Row) => `${r.siriId}|${r.dep.route}|${r.dep.scheduled}`;

/** pinned departure if it is still catchable, otherwise the nearest one */
export function pickRow(rows: Row[], pin?: string): Row | undefined {
  return (pin && rows.find(r => rowKey(r) === pin)) || rows[0];
}

export function watchNotice(r: Row, locName: string): { title: string; body: string } {
  const walkSec = r.inSec - r.leaveInSec;
  const leaveAt = fmtClock(r.dep.expected - walkSec);
  const title = r.leaveInSec < 60 ? 'Выходите сейчас' : `Выходите в ${leaveAt} (через ${fmtMinutes(r.leaveInSec)})`;
  const to = r.arrive ? ` → ${r.arrive.stopName}` : '';
  const arr = r.arrive ? ` · прибытие ${fmtClock(r.arrive.sec)}` : '';
  return { title, body: `${r.dep.route}${to} · отправление ${fmtClock(r.dep.expected)}${arr}\n${locName}` };
}

export function loadWatch(): Watch | null {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Watch | null;
    return w && w.until > Date.now() ? w : null;
  } catch { return null; }
}

export function saveWatch(w: Watch | null) {
  if (w) localStorage.setItem(KEY, JSON.stringify(w)); else localStorage.removeItem(KEY);
}
