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
  const { toast } = useStore();
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
            {tx('I have written it down')}
          </Button>
        </>
      }
    >
      <div className="stack gap-3">
        <p className="num" style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: 1, textAlign: 'center', overflowWrap: 'anywhere' }}>
          {code}
        </p>
        <Callout tone="warn" icon="alert">
          {tx('If you forget your password, this code is the only way to set a new one. Keep it on paper, somewhere safe, not only on this phone. You can make a new code in Settings; that cancels this one.')}
        </Callout>
      </div>
    </Modal>
  );
}
