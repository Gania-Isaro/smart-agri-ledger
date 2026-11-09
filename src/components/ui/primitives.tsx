/** Shared UI primitives: buttons, fields, badges, empty and loading states. */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './Icon';
import type { StatusMeta } from '../../domain/status';
import { useT } from '../../i18n';

import { tx } from '../../i18n/tx';
/* ---------------------------------------------------------------- button */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet-danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  block,
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 14 : 16} /> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  size = 18,
  ...rest
}: { icon: IconName; label: string; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="iconbtn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ animation: 'spin 700ms linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.6" opacity="0.25" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </svg>
  );
}

/* ----------------------------------------------------------------- badge */

export function Badge({ meta, compact }: { meta: StatusMeta; compact?: boolean }) {
  const t = useT();
  // A keyed status resolves to a translated label; anything ad-hoc keeps its own.
  const label = meta.key ? t(`status.${meta.key}`) : meta.label;
  return (
    <span className={`badge badge--${meta.tone}`} title={meta.help}>
      <span className="badge__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      {!compact && label}
    </span>
  );
}

export function Chip({
  children,
  on,
  onRemove,
  ...rest
}: { children: ReactNode; on?: boolean; onRemove?: () => void } & ButtonHTMLAttributes<HTMLButtonElement>) {
  if (onRemove) {
    return (
      <span className={`chip ${on ? 'chip--on' : ''}`}>
        {children}
        <button onClick={onRemove} aria-label={tx('Remove filter')}>
          <Icon name="x" size={12} />
        </button>
      </span>
    );
  }
  return (
    <button className={`chip ${on ? 'chip--on' : ''}`} {...rest}>
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- field */

interface FieldProps {
  label: string;
  children: ReactNode;
  help?: string;
  error?: string;
  required?: boolean;
  full?: boolean;
  /** Explicitly half-width inside a .formgrid; the opposite of `full`. */
  half?: boolean;
  htmlFor?: string;
  suffix?: string;
}

export function Field({ label, children, help, error, required, full, half, htmlFor, suffix }: FieldProps) {
  return (
    <div className={`field ${full && !half ? 'field--full' : ''} ${suffix ? 'field--money' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="field__req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {suffix && <span className="field__suffix">{suffix}</span>}
      {error ? (
        <span className="field__error" role="alert">
          <Icon name="alert" size={12} />
          {error}
        </span>
      ) : help ? (
        <span className="field__help">{help}</span>
      ) : null}
    </div>
  );
}

export function Input({ invalid, ...rest }: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${invalid ? 'input--invalid' : ''}`} {...rest} />;
}

export function MoneyInput({ invalid, ...rest }: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`input input--money num ${invalid ? 'input--invalid' : ''}`}
      inputMode="numeric"
      type="number"
      step={1}
      min={0}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  options,
  placeholder,
  ...rest
}: {
  invalid?: boolean;
  options: { value: string; label: string }[];
  placeholder?: string;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select ${invalid ? 'input--invalid' : ''}`} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea({ invalid, ...rest }: { invalid?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${invalid ? 'input--invalid' : ''}`} rows={3} {...rest} />;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" />
      <span>{label}</span>
    </label>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <span
      className={`checkbox ${checked ? 'checkbox--on' : indeterminate ? 'checkbox--mixed' : ''}`}
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      tabIndex={0}
      id={id}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          onChange(!checked);
        }
      }}
    >
      {(checked || indeterminate) && <Icon name={indeterminate ? 'minus' : 'check'} size={11} strokeWidth={3} />}
    </span>
  );
}

/* ------------------------------------------------------- states & layout */

export function EmptyState({
  icon = 'inbox',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__art">
        <Icon name={icon} size={24} />
      </div>
      <p className="empty__title">{title}</p>
      {message && <p className="empty__msg">{message}</p>}
      {action && <div style={{ marginTop: 'var(--s-3)' }}>{action}</div>}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14, radius }: { width?: string | number; height?: number; radius?: number }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius }} />;
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: 'var(--s-4)' }}>
      <div className="stack gap-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="row gap-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} width={c === 0 ? 180 : `${100 / cols}%`} height={13} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="metrics">
      {Array.from({ length: count }).map((_, i) => (
        <div className="metric" key={i}>
          <Skeleton width={90} height={10} />
          <div style={{ height: 8 }} />
          <Skeleton width={120} height={24} />
        </div>
      ))}
    </div>
  );
}

export function Callout({
  tone = 'info',
  icon = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'danger';
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className={`callout callout--${tone}`}>
      <Icon name={icon} size={17} />
      <div>{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- tooltip */

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top - 8 });
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>
      {pos && (
        <span className="tooltip" role="tooltip" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}>
          {text}
        </span>
      )}
    </>
  );
}

export function InfoDot({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <span style={{ color: 'var(--c-faint)', display: 'inline-flex', cursor: 'help' }} tabIndex={0} aria-label={text}>
        <Icon name="info" size={13} />
      </span>
    </Tooltip>
  );
}

/* -------------------------------------------------------------- popover */

export function Popover({
  anchorRef,
  onClose,
  children,
  align = 'left',
  width,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = width ?? el.offsetWidth;
      const h = el.offsetHeight;
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      const below = a.bottom + 6;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, a.top - h - 6) : below;
      setStyle({ left, top, width, visibility: 'visible' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, align, width]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  return (
    <div className="popover" ref={ref} style={style} role="dialog">
      {children}
    </div>
  );
}
