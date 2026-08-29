/** Modal dialog. Becomes a bottom sheet on phones (see components.css). */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'default' | 'wide';
  /** Stops a stray click on the backdrop from discarding a half-typed form. */
  dismissOnBackdrop?: boolean;
  flush?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'default',
  dismissOnBackdrop = false,
  flush = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const trap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const nodes = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      trap(e);
    };
    document.addEventListener('keydown', onKey, true);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first real control, not the close button, the user came here
    // to fill something in.
    const t = window.setTimeout(() => {
      const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      const target = [...(nodes ?? [])].find((n) => !n.hasAttribute('data-close')) ?? nodes?.[0];
      target?.focus();
    }, 40);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose, trap]);

  if (!open) return null;

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${size === 'wide' ? 'modal--wide' : size === 'narrow' ? 'modal--narrow' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal__head">
          <div className="grow">
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__sub">{subtitle}</p>}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close" data-close>
            <Icon name="x" size={18} />
          </button>
        </div>

        {flush ? children : <div className="modal__body">{children}</div>}

        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
