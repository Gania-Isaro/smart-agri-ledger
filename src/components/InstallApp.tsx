/**
 * "Install app": puts Smart Agri-Ledger on the phone like any other app.
 * On Android (Chrome) one tap installs it. Where the browser cannot do that
 * (iPhone, some other browsers) it shows the few steps to do it by hand.
 */

import { useEffect, useState } from 'react';
import { Button } from './ui/primitives';
import { Modal } from './ui/Modal';
import { Icon } from './ui/Icon';
import { tx } from '../i18n/tx';
import { canInstallNow, installNow, isInstalled, isIPhone, onInstallChange } from '../lib/install';

const HIDE_KEY = 'agri.install.hidden';

function useInstallState() {
  const [, bump] = useState(0);
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);
  return { installed: isInstalled(), oneTap: canInstallNow() };
}

/** The button and, when needed, the how-to. `variant` picks how loud it is. */
export function InstallButton({ block, variant = 'secondary' }: { block?: boolean; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const { installed, oneTap } = useInstallState();
  const [help, setHelp] = useState(false);
  if (installed) return null;
  return (
    <>
      <Button
        variant={variant}
        icon="download"
        block={block}
        onClick={async () => {
          if (oneTap) await installNow();
          else setHelp(true);
        }}
      >
        {tx('Install the app on this phone')}
      </Button>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </>
  );
}

function InstallHelp({ onClose }: { onClose: () => void }) {
  const iphone = isIPhone();
  const steps = iphone
    ? [
        tx('Open this page in Safari.'),
        tx('Tap the Share button (the square with an arrow pointing up) at the bottom of the screen.'),
        tx('Scroll down and tap Add to Home Screen, then Add.'),
        tx('Open Smart Agri-Ledger from the new icon on your home screen.'),
      ]
    : [
        tx('Open this page in Chrome.'),
        tx('Tap the menu (three dots) at the top right.'),
        tx('Tap Install app or Add to Home screen, then Install.'),
        tx('Open Smart Agri-Ledger from the new icon, like any other app.'),
      ];
  return (
    <Modal
      open
      onClose={onClose}
      dismissOnBackdrop
      title={tx('Install the app')}
      subtitle={tx('It gets its own icon, opens full screen and works with no signal.')}
      footer={
        <>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>{tx('OK')}</Button>
        </>
      }
    >
      <ol className="stack gap-2" style={{ paddingLeft: '1.4em', listStyle: 'decimal' }}>
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </Modal>
  );
}

/**
 * A bar at the top of the app suggesting to install it, until it is installed
 * or the person closes the bar on this phone.
 */
export function InstallBar() {
  const { installed } = useInstallState();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (installed || hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_KEY, '1');
    } catch {
      /* it shows again next time */
    }
  };
  return (
    <div className="callout callout--info no-print" role="status" style={{ marginBottom: 'var(--s-4)', alignItems: 'center', flexWrap: 'wrap' }}>
      <Icon name="download" size={17} />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <b>{tx('Use it as an app.')}</b> {tx('Install it on this phone: it gets its own icon and works with no signal.')}
      </div>
      <div className="row gap-1">
        <InstallButton variant="primary" />
        <button className="linkbtn" onClick={hide}>{tx('Not now')}</button>
      </div>
    </div>
  );
}
