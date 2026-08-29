/**
 * Sign in.
 *
 * The owner and the manager share one account, so this is a plain credential
 * screen rather than an account picker: an email and a PIN, exactly what they
 * would expect from any other app on the phone.
 *
 * This build authenticates against the local database because it runs offline
 * with no server behind it. Everything the rest of the app relies on — who is
 * acting, what they may do, whose name lands in the audit trail — already flows
 * from the returned user, so pointing this screen at a real identity provider
 * later changes this file and nothing else.
 */

import { useState } from 'react';
import { BrandMark, Icon } from '../components/ui/Icon';
import { Button, Callout, Field, Input } from '../components/ui/primitives';
import { useStore } from '../state/store';
import { usePrefs } from '../i18n';
import { LANGUAGES } from '../i18n/strings';

export function Login() {
  const { users, signIn, toast } = useStore();
  const { t, lang, setLang } = usePrefs();

  const account = users[0];
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const match = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!match) {
        // Deliberately vague: naming which half was wrong tells anyone holding
        // the phone which addresses are real.
        setError(t('login.badCredentials'));
        return;
      }
      await signIn(match.id, pin);
      toast({ tone: 'success', title: t('login.signedIn', { name: match.name }) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="login__mark">
            <BrandMark size={24} />
          </span>
          <div>
            <div className="login__title">{t('app.name')}</div>
            <div className="login__tag">{t('app.tagline')}</div>
          </div>
          <span className="spacer" />
          {/* Language before sign-in: whoever is holding the phone should be
              able to read the screen before they have an account context. */}
          <div className="row gap-1">
            {LANGUAGES.map((l) => (
              <button
                key={l.value}
                type="button"
                className={`chip ${lang === l.value ? 'chip--on' : ''}`}
                onClick={() => setLang(l.value)}
                aria-pressed={lang === l.value}
                style={{ height: 26, padding: '0 9px' }}
              >
                {l.value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="stack gap-4">
          <Field label={t('login.email')} required htmlFor="login-email">
            <Input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="owner@agriledger.rw"
              invalid={Boolean(error)}
              autoFocus
            />
          </Field>

          <Field label={t('login.pin')} required error={error} htmlFor="login-pin">
            <div style={{ position: 'relative' }}>
              <Input
                id="login-pin"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError('');
                }}
                placeholder="••••"
                maxLength={8}
                invalid={Boolean(error)}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                className="iconbtn"
                onClick={() => setShowPin((v) => !v)}
                aria-label={showPin ? t('login.hidePin') : t('login.showPin')}
                style={{ position: 'absolute', right: 2, top: 1, width: 34, height: 34 }}
              >
                <Icon name="eye" size={16} />
              </button>
            </div>
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={!pin.trim() || !email.trim()}
          >
            {t('action.signIn')}
          </Button>

          {account && (
            <p className="muted" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>
              {t('login.demoHint', { email: account.email, pin: account.pin })}
            </p>
          )}

          <Callout tone="info" icon="wifi-off">
            {t('app.offlineNote')}
          </Callout>
        </form>
      </div>
    </div>
  );
}
