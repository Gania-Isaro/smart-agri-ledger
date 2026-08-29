/**
 * Filter bar.
 *
 * Filters stack: every one narrows what the previous ones left, so
 * "maize farmers in Rwamagana who delivered over 100 KG in August and have not
 * been paid" is five clicks rather than a query language. Active filters stay
 * visible as removable chips — a filter you have forgotten about is how people
 * end up trusting a wrong number.
 */

import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui/Icon';
import { Button, Chip, Field, Input, Popover, Select } from './ui/primitives';
import { useT } from '../i18n';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSpec {
  key: string;
  label: string;
  type: 'select' | 'multi' | 'daterange' | 'numrange';
  options?: FilterOption[];
}

export type FilterValues = Record<string, string | string[] | { from?: string; to?: string } | { min?: string; max?: string } | undefined>;

export function FilterBar({
  specs,
  values,
  onChange,
  children,
  savedViewSlot,
}: {
  specs: FilterSpec[];
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  children?: ReactNode;
  savedViewSlot?: ReactNode;
}) {
  const t = useT();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const active = specs
    .map((spec) => ({ spec, chip: describe(spec, values[spec.key]) }))
    .filter((x) => x.chip !== null);

  return (
    <div className="filterbar">
      <button
        className="btn btn--secondary"
        ref={btn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon name="filter" size={15} />
        {t('action.filters')}
        {active.length > 0 && (
          <span
            style={{
              background: 'var(--primary)',
              color: '#fff',
              borderRadius: 'var(--r-full)',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
            }}
          >
            {active.length}
          </span>
        )}
      </button>

      {active.map(({ spec, chip }) => (
        <Chip key={spec.key} on onRemove={() => onChange({ ...values, [spec.key]: undefined })}>
          <span className="muted" style={{ fontWeight: 500 }}>
            {spec.label}:
          </span>
          {chip}
        </Chip>
      ))}

      {active.length > 1 && (
        <Button size="sm" variant="ghost" onClick={() => onChange({})}>
          {t('action.clearAll')}
        </Button>
      )}

      {children}
      {savedViewSlot}

      {open && (
        <Popover anchorRef={btn} onClose={() => setOpen(false)} width={420}>
          <div className="filterpop">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="eyebrow">Filter this view</span>
              <button className="btn btn--ghost btn--sm" onClick={() => onChange({})}>
                {t('action.reset')}
              </button>
            </div>

            {specs.map((spec) => (
              <FilterControl
                key={spec.key}
                spec={spec}
                value={values[spec.key]}
                onChange={(v) => onChange({ ...values, [spec.key]: v })}
              />
            ))}

            <Button variant="primary" block onClick={() => setOpen(false)}>
              {t('action.showResults')}
            </Button>
          </div>
        </Popover>
      )}
    </div>
  );
}

function FilterControl({
  spec,
  value,
  onChange,
}: {
  spec: FilterSpec;
  value: FilterValues[string];
  onChange: (v: FilterValues[string]) => void;
}) {
  if (spec.type === 'daterange') {
    const v = (value ?? {}) as { from?: string; to?: string };
    return (
      <div className="filterrow">
        <Field label={`${spec.label} from`}>
          <Input type="date" value={v.from ?? ''} onChange={(e) => onChange({ ...v, from: e.target.value || undefined })} />
        </Field>
        <Field label="to">
          <Input type="date" value={v.to ?? ''} onChange={(e) => onChange({ ...v, to: e.target.value || undefined })} />
        </Field>
        <Button variant="ghost" size="sm" onClick={() => onChange(undefined)} aria-label={`Clear ${spec.label}`}>
          <Icon name="x" size={14} />
        </Button>
      </div>
    );
  }

  if (spec.type === 'numrange') {
    const v = (value ?? {}) as { min?: string; max?: string };
    return (
      <div className="filterrow">
        <Field label={`${spec.label} at least`}>
          <Input type="number" inputMode="decimal" value={v.min ?? ''} placeholder="0" onChange={(e) => onChange({ ...v, min: e.target.value || undefined })} />
        </Field>
        <Field label="at most">
          <Input type="number" inputMode="decimal" value={v.max ?? ''} placeholder="Any" onChange={(e) => onChange({ ...v, max: e.target.value || undefined })} />
        </Field>
        <Button variant="ghost" size="sm" onClick={() => onChange(undefined)} aria-label={`Clear ${spec.label}`}>
          <Icon name="x" size={14} />
        </Button>
      </div>
    );
  }

  if (spec.type === 'multi') {
    const selected = (value ?? []) as string[];
    return (
      <div className="field">
        <span className="field__label">{spec.label}</span>
        <div className="row gap-2 wrap">
          {(spec.options ?? []).map((o) => {
            const on = selected.includes(o.value);
            return (
              <Chip
                key={o.value}
                on={on}
                onClick={() =>
                  onChange(on ? selected.filter((s) => s !== o.value) : [...selected, o.value])
                }
              >
                {on && <Icon name="check" size={11} />}
                {o.label}
              </Chip>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Field label={spec.label}>
      <Select
        options={spec.options ?? []}
        placeholder="Any"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </Field>
  );
}

function describe(spec: FilterSpec, value: FilterValues[string]): string | null {
  if (value === undefined || value === '') return null;

  if (spec.type === 'multi') {
    const arr = value as string[];
    if (arr.length === 0) return null;
    if (arr.length === 1) return spec.options?.find((o) => o.value === arr[0])?.label ?? arr[0]!;
    return `${arr.length} selected`;
  }

  if (spec.type === 'daterange') {
    const v = value as { from?: string; to?: string };
    if (!v.from && !v.to) return null;
    if (v.from && v.to) return `${v.from} → ${v.to}`;
    return v.from ? `from ${v.from}` : `up to ${v.to}`;
  }

  if (spec.type === 'numrange') {
    const v = value as { min?: string; max?: string };
    if (!v.min && !v.max) return null;
    if (v.min && v.max) return `${v.min} – ${v.max}`;
    return v.min ? `≥ ${v.min}` : `≤ ${v.max}`;
  }

  return spec.options?.find((o) => o.value === value)?.label ?? String(value);
}

/* ------------------------------------------------------------- predicates */

export function matchesSelect(value: FilterValues[string], actual: string | undefined): boolean {
  if (value === undefined || value === '') return true;
  return actual === value;
}

export function matchesMulti(value: FilterValues[string], actual: string | undefined): boolean {
  const arr = (value ?? []) as string[];
  if (arr.length === 0) return true;
  return actual !== undefined && arr.includes(actual);
}

export function matchesDate(value: FilterValues[string], actual: string | undefined | null): boolean {
  const v = (value ?? {}) as { from?: string; to?: string };
  if (!v.from && !v.to) return true;
  if (!actual) return false;
  if (v.from && actual < v.from) return false;
  if (v.to && actual > v.to) return false;
  return true;
}

export function matchesNumber(value: FilterValues[string], actual: number | undefined | null): boolean {
  const v = (value ?? {}) as { min?: string; max?: string };
  if (!v.min && !v.max) return true;
  if (actual === undefined || actual === null) return false;
  if (v.min && actual < Number(v.min)) return false;
  if (v.max && actual > Number(v.max)) return false;
  return true;
}
