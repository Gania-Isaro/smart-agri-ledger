/**
 * Identifier generation.
 *
 * IDs are opaque and generated on the device, so records can be created with no
 * network and still merge cleanly if this database is ever synced to a server.
 * Human-facing codes (FR-001, TXN-2026-000184) are generated separately by the
 * services, which hold a counter table so the sequence has no gaps.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function uid(prefix = ''): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  // Time prefix keeps IDs roughly sortable by creation, which makes debugging
  // and IndexedDB range scans cheaper.
  const t = Date.now().toString(36);
  return `${prefix}${prefix ? '_' : ''}${t}${out}`;
}

export function padCode(prefix: string, n: number, width = 3): string {
  return `${prefix}${String(n).padStart(width, '0')}`;
}
