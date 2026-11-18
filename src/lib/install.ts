/**
 * Installing the app on a phone.
 *
 * Chrome on Android offers to install a web app once, early, through the
 * `beforeinstallprompt` event. It is caught here as soon as the app starts,
 * so an "Install app" button can use it later. Installed this way the app has
 * its own icon in the app drawer, opens full screen and works offline.
 *
 * iPhones never offer this: there, people use Share, then Add to Home Screen,
 * so the button shows how instead.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function startInstallWatch(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the offer for our own button instead of the browser's mini bar.
    e.preventDefault();
    offer = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    changed();
  });
}

export function onInstallChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True when the app is already running as an installed app. */
export function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIPhone(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Chrome offered to install, so one tap does it. */
export function canInstallNow(): boolean {
  return offer !== null;
}

/** Show the phone's own install box. Returns true if the person said yes. */
export async function installNow(): Promise<boolean> {
  if (!offer) return false;
  const o = offer;
  offer = null;
  await o.prompt();
  const choice = await o.userChoice;
  changed();
  return choice.outcome === 'accepted';
}
