/** Toast stack and the confirmation dialog, both driven from the store. */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../state/store';
import { Icon, type IconName } from './Icon';
import { Modal } from './Modal';
import { Button, Field, Input, Textarea } from './primitives';

import { tx } from '../../i18n/tx';
const TOAST_ICON: Record<string, IconName> = {
  success: 'check',
  error: 'alert',
  warn: 'alert',
  info: 'info',
};

export function Toaster() {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;

  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          <Icon name={TOAST_ICON[t.tone] ?? 'info'} size={17} />
          <div className="toast__body">
            <div className="toast__title">{t.title}</div>
            {t.message && <div className="toast__msg">{t.message}</div>}
          </div>
          {t.action && (
            <button
              className="toast__action"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast__action" onClick={() => dismissToast(t.id)} aria-label={tx('Dismiss')}>
            <Icon name="x" size={15} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function ConfirmDialog() {
  const { confirmState, closeConfirm } = useStore();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    setTyped('');
    setReason('');
  }, [confirmState]);

  if (!confirmState) return null;

  const needsType = Boolean(confirmState.typeToConfirm);
  const needsReason = Boolean(confirmState.reasonLabel);
  const typeOk = !needsType || typed.trim().toUpperCase() === confirmState.typeToConfirm!.toUpperCase();
  const reasonOk = !needsReason || reason.trim().length >= 5;

  return (
    <Modal
      open
      onClose={() => closeConfirm({ ok: false })}
      title={confirmState.title}
      size="narrow"
      footer={
        <>
          <Button variant="ghost" onClick={() => closeConfirm({ ok: false })}>
            {confirmState.cancelLabel ?? tx('Cancel')}
          </Button>
          <Button
            variant={confirmState.tone === 'danger' ? 'danger' : 'primary'}
            disabled={!typeOk || !reasonOk}
            onClick={() => closeConfirm({ ok: true, reason: reason.trim() || undefined })}
          >
            {confirmState.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="stack gap-4">
        <div style={{ fontSize: 'var(--fs-md)', lineHeight: 1.55, color: 'var(--text-soft)' }}>
          {confirmState.message}
        </div>

        {needsReason && (
          <Field label={confirmState.reasonLabel!} required help={tx('Recorded in the audit trail against your name.')}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tx('Explain briefly why this is being done')}
            />
          </Field>
        )}

        {needsType && (
          <Field label={tx('Type {typeToConfirm} to continue', { typeToConfirm: confirmState.typeToConfirm })} required>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={confirmState.typeToConfirm}
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
