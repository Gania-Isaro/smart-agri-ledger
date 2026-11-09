/**
 * Plain-sentence translation.
 *
 * `t('some.key')` covers the shell and shared labels. Everything else, screen
 * text, buttons, toasts and the error messages services throw, is written in
 * English and passed through `tx`, which looks up the Kinyarwanda sentence in
 * RW_PHRASES. Writing the English inline keeps each screen readable, and one
 * dictionary keeps every sentence translated in the same place.
 *
 * Variables use {name} placeholders so word order can change between the two
 * languages: tx('{name} worked on {date}', { name, date }).
 *
 * `tx` is a plain function, not a hook, so services can use it for the errors
 * they throw. The app remounts its screens when the language changes, so
 * nothing keeps an old translation on screen.
 */

import { RW_PHRASES } from './phrases';
import { CROP_NAMES_RW, type Lang } from './strings';

let current: Lang = 'en';

export function setTxLang(lang: Lang): void {
  current = lang;
}

export function txLang(): Lang {
  return current;
}

export function tx(english: string, vars?: Record<string, string | number | undefined | null>): string {
  const found = current === 'rw' ? RW_PHRASES[english] : english;
  if (found === undefined && import.meta.env.DEV) {
    // Development only: list sentences still missing Kinyarwanda.
    const w = window as unknown as { __txMissing?: Set<string> };
    (w.__txMissing ??= new Set()).add(english);
  }
  const raw = found ?? english;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? m : String(v);
  });
}

/** Count-aware: uses `one` when n is 1, `many` otherwise. Both go through tx. */
export function txn(n: number, one: string, many: string, vars?: Record<string, string | number | undefined | null>): string {
  return tx(n === 1 ? one : many, { count: n, ...vars });
}

/**
 * Wrap a fixed lookup table (defined once at the top of a file) so every
 * English text value in it is translated at the moment it is read. Values that
 * start with a capital letter are treated as text; ids and keys stay as they
 * are. Nested objects and arrays are wrapped the same way.
 */
export function translated<T extends object>(table: T): T {
  return new Proxy(table, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value === 'string') return /^[A-Z]/.test(value) ? tx(value) : value;
      if (value && typeof value === 'object') return translated(value as object);
      return value;
    },
  });
}

/** A crop's name in the language in use. Crop names users add stay as typed. */
export function cropLabel(crop: { id: string; name: string } | undefined | null): string {
  if (!crop) return '-';
  return current === 'rw' ? CROP_NAMES_RW[crop.id] ?? crop.name : crop.name;
}
