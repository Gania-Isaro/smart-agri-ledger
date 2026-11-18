/**
 * Shows a new recovery code once, right after it is made, and keeps it on
 * screen until the person says they wrote it down. A phone account has no
 * email to send a reset link to, so this code is the owner's only way back in
 * after a forgotten password.
 */

import { useEffect, useState } from 'react';
import { Button, Callout } from './ui/primitives';
import { Modal } from './ui/Modal';
import { useStore } from '../state/store';
import { tx } from '../i18n/tx';
import { RECOVERY_EVENT, RECOVERY_KEY } from '../cloud/account';

function waiting(): string | null {
  try {
    return sessionStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}

export function RecoveryNotice() {
  const { toast, membership } = useStore();
  const [code, setCode] = useState<string | null>(waiting);

  useEffect(() => {
    const show = () => setCode(waiting());
    window.addEventListener(RECOVERY_EVENT, show);
    return () => window.removeEventListener(RECOVERY_EVENT, show);
  }, []);

  if (!code) return null;

  const done = () => {
    try {
      sessionStorage.removeItem(RECOVERY_KEY);
    } catch {
      /* it is gone when the tab closes anyway */
    }
    setCode(null);
  };

  // The app cannot send a text by itself (that needs a paid SMS service), so
  // it opens the phone's own Messages app with the code ready to send to the
  // person's own number. One tap on Send and the code is kept in their SMS.
  const message = tx('Smart Agri-Ledger recovery code: {code}. Keep this message. It sets a new password if you forget yours.', { code });
  const myNumber = (membership?.email ?? '').includes('@') ? '' : (membership?.email ?? '').replace(/[^+\d]/g, '');
  const smsLink = `sms:${myNumber}?body=${encodeURIComponent(message)}`;
  const share = async () => {
    try {
      await navigator.share({ text: message });
    } catch {
      /* closed without sharing */
    }
  };

  return (
    <Modal
      open
      onClose={() => undefined}
      title={tx('Write down your recovery code')}
      subtitle={tx('It is shown only this once.')}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              toast({ tone: 'success', title: tx('Code copied') });
            }}
          >
            {tx('Copy')}
          </Button>
          <span className="spacer" />
          <Button variant="primary" icon="check" onClick={done}>
            {tx('I saved it')}
          </Button>
        </>
      }
    >
      <div className="stack gap-3">
        <p className="num" style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: 1, textAlign: 'center', overflowWrap: 'anywhere' }}>
          {code}
        </p>
        <div className="row gap-2 wrap" style={{ justifyContent: 'center' }}>
          <a className="btn btn--secondary" href={smsLink}>
            {tx('Send it to my phone by SMS')}
          </a>
          {typeof navigator.share === 'function' && (
            <Button onClick={() => void share()}>{tx('Share (WhatsApp...)')}</Button>
          )}
        </div>
        <Callout tone="warn" icon="alert">
          {tx('If you forget your password, this code is the only way to set a new one. Send it to your phone and also keep it on paper, somewhere safe. You can make a new code in Settings; that cancels this one.')}
        </Callout>
      </div>
    </Modal>
  );
}
