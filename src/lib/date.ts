/** Date helpers. Everything the app stores is an ISO 'YYYY-MM-DD' string. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function today(): string {
  return toISODate(new Date());
}

export function nowStamp(): string {
  return new Date().toISOString();
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** `24 Aug` — the compact form used in table cells. */
export function formatDateShort(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = parseISODate(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** `24 Aug 2026` — used in detail views and reports. */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = parseISODate(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(isoStamp: string | undefined | null): string {
  if (!isoStamp) return '—';
  const d = new Date(isoStamp);
  if (Number.isNaN(d.getTime())) return '—';
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

/** `3 days ago` — for audit trails and notifications. */
export function timeAgo(isoStamp: string): string {
  const then = new Date(isoStamp).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.floor(months / 12)} year${months < 24 ? '' : 's'} ago`;
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(y).slice(2)}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** Inclusive range test tolerant of empty bounds. */
export function inRange(iso: string, from?: string | null, to?: string | null): boolean {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

/** Rwandan agricultural seasons: A (Sep-Feb), B (Mar-Jun), C (Jul-Aug, marshland). */
export function seasonFor(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (month >= 9) return `${year + 1} A`;
  if (month <= 2) return `${year} A`;
  if (month <= 6) return `${year} B`;
  return `${year} C`;
}
