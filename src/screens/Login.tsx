/**
 * Sign in, create an account, and recover a forgotten PIN.
 *
 * A new account starts with an empty book, no farmers, no money, nothing to
 * delete before it is theirs. The demo account is kept alongside, with its PIN
 * printed on the screen, so anyone can see a working cooperative in ten seconds
 * without signing up for anything.
 *
 * On recovery: a real "email me a reset link" needs a server to send the mail
 * and verify the token, and this app has neither, it runs entirely on the
 * device. Rather than show a "check your email" message that no email would
 * ever follow, recovery uses a code issued at sign-up. The screen says plainly
 * which of the two is happening, because a login screen that lies about having
 * sent an email is worse than one that admits it cannot.
 */

import { useEffect, useState } from 'react';
import { BrandMark, Icon } from '../components/ui/Icon';
import { Button, Callout, Field, Input } from '../components/ui/primitives';
import { useStore } from '../state/store';
import { usePrefs } from '../i18n';
import { LANGUAGES } from '../i18n/strings';
import { DEMO_EMAIL, DEMO_PIN } from '../db/accounts';
import { CloudLogin } from './CloudLogin';
import { supabase } from '../cloud/client';

import { tx } from '../i18n/tx';
type Mode = 'signin' | 'signup' | 'forgot';

export function Login() {
  const { t, lang, setLang } = usePrefs();
  const [mode, setMode] = useState<Mode>('signin');
  /** Set once an account is created or a PIN reset; cleared on continue. */
  const [issued, setIssued] = useState<{ code: string; email: string; pin: string } | null>(null);
  const { cloudEnabled } = useStore();
  /* Online sign-in comes first when the app is set up for it; the
     phone-only accounts and the demo stay one tap away. */
  const [where, setWhere] = useState<'online' | 'device'>(cloudEnabled ? 'online' : 'device');
  const recovering = useRecoveryLink();

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

        {recovering ? (
          <NewPasswordForm />
        ) : where === 'online' ? (
          <CloudLogin onUseDevice={() => setWhere('device')} />
        ) : issued ? (
          <RecoveryCodeShown issued={issued} onDone={() => setIssued(null)} />
        ) : (
          <>
            <div className="tabs" style={{ marginBottom: 'var(--s-5)' }} role="tablist">
              <button
                className={`tab ${mode === 'signin' || mode === 'forgot' ? 'tab--on' : ''}`}
                onClick={() => setMode('signin')}
                role="tab"
                aria-selected={mode === 'signin'}
              >
                {t('action.signIn')}
              </button>
              <button
                className={`tab ${mode === 'signup' ? 'tab--on' : ''}`}
                onClick={() => setMode('signup')}
                role="tab"
                aria-selected={mode === 'signup'}
              >
                {t('auth.createAccount')}
              </button>
            </div>

            {mode === 'signin' && <SignIn onForgot={() => setMode('forgot')} />}
            {mode === 'signup' && <SignUp onIssued={setIssued} />}
            {mode === 'forgot' && <Forgot onBack={() => setMode('signin')} onIssued={setIssued} />}
            {cloudEnabled && (
              <Button variant="ghost" block onClick={() => setWhere('online')} style={{ marginTop: 'var(--s-4)' }}>
                {tx('Use the online account (owner, field manager, accountant)')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------- password reset link */

/** True after someone opened the "set a new password" link from their email. */
function useRecoveryLink(): boolean {
  const { cloudEnabled } = useStore();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!cloudEnabled) return;
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setOn(true);
    });
    return () => data.subscription.unsubscribe();
  }, [cloudEnabled]);
  return on;
}

function NewPasswordForm() {
  const { cloudSignIn, toast, fail } = useStore();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const sb = supabase();
      const { data, error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      const email = data.user?.email ?? '';
      await sb.auth.signOut();
      await cloudSignIn(email, password);
      toast({ tone: 'success', title: tx('New password saved') });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack gap-4" onSubmit={submit}>
      <Field label={tx('New password')} required help={tx('At least 6 characters.')}>
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Save the new password')}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------- sign in */

function SignIn({ onForgot }: { onForgot: () => void }) {
  const { signIn, toast } = useStore();
  const { t } = usePrefs();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent, asDemo = false) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(asDemo ? DEMO_EMAIL : email, asDemo ? DEMO_PIN : pin);
      toast({ tone: 'success', title: t('login.signedIn', { name: asDemo ? 'Isaro Gania' : email }) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack gap-4">
      <Field label={t('login.email')} required htmlFor="signin-email">
        <Input
          id="signin-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError('');
          }}
          placeholder={tx('you@cooperative.rw')}
          invalid={Boolean(error)}
          autoFocus
        />
      </Field>

      <PinField
        id="signin-pin"
        label={t('login.pin')}
        value={pin}
        onChange={(v) => {
          setPin(v);
          setError('');
        }}
        error={error}
      />

      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!email.trim() || !pin.trim()}>
        {t('action.signIn')}
      </Button>

      <button type="button" className="btn btn--ghost" onClick={onForgot}>
        {t('auth.forgotPin')}
      </button>

      <div className="divider" style={{ margin: 'var(--s-2) 0' }} />

      {/* The demo is the fastest honest answer to "what is this?" */}
      <div className="callout callout--info" style={{ flexDirection: 'column', gap: 'var(--s-3)' }}>
        <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
          <Icon name="eye" size={17} />
          <div>
            <b>{t('auth.demoTitle')}</b>
            <div style={{ marginTop: 2 }}>{t('auth.demoBody')}</div>
          </div>
        </div>
        <Button variant="secondary" block onClick={(e) => void submit(e, true)} loading={busy}>
          {t('auth.demoButton')}
        </Button>
        <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.85 }}>
          {t('login.demoHint', { email: DEMO_EMAIL, pin: DEMO_PIN })}
        </span>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- sign up */

function SignUp({ onIssued }: { onIssued: (v: { code: string; email: string; pin: string }) => void }) {
  const { signUp } = useStore();
  const { t } = usePrefs();
  const [form, setForm] = useState({ name: '', email: '', cooperativeName: '', pin: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.pin !== form.confirm) {
      setError(t('auth.pinMismatch'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { recoveryCode } = await signUp({
        name: form.name,
        email: form.email,
        cooperativeName: form.cooperativeName,
        pin: form.pin,
      });
      onIssued({ code: recoveryCode, email: form.email, pin: form.pin });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack gap-4">
      <Field label={t('auth.yourName')} required htmlFor="su-name">
        <Input id="su-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus autoComplete="name" />
      </Field>

      <Field label={t('field.cooperative')} required htmlFor="su-coop" help={t('auth.coopHelp')}>
        <Input id="su-coop" value={form.cooperativeName} onChange={(e) => set('cooperativeName', e.target.value)} />
      </Field>

      <Field label={t('login.email')} required htmlFor="su-email" help={t('auth.emailHelp')}>
        <Input
          id="su-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </Field>

      <PinField
        id="su-pin"
        label={t('auth.choosePin')}
        value={form.pin}
        onChange={(v) => set('pin', v)}
        help={t('auth.pinHelp')}
      />

      <PinField
        id="su-confirm"
        label={t('auth.confirmPin')}
        value={form.confirm}
        onChange={(v) => set('confirm', v)}
        error={error}
      />

      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {t('auth.createAccount')}
      </Button>

      <Callout tone="info" icon="sprout">
        {t('auth.blankStart')}
      </Callout>
    </form>
  );
}

/* -------------------------------------------------------- forgotten PIN */

function Forgot({
  onBack,
  onIssued,
}: {
  onBack: () => void;
  onIssued: (v: { code: string; email: string; pin: string }) => void;
}) {
  const { resetPin } = useStore();
  const { t } = usePrefs();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin !== confirm) {
      setError(t('auth.pinMismatch'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { recoveryCode } = await resetPin(email, code, pin);
      onIssued({ code: recoveryCode, email, pin });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack gap-4">
      <div>
        <h2 className="section-title">{t('auth.resetTitle')}</h2>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
          {t('auth.resetSub')}
        </p>
      </div>

      <Field label={t('login.email')} required htmlFor="fp-email">
        <Input
          id="fp-email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError('');
          }}
          autoFocus
        />
      </Field>

      <Field label={t('auth.recoveryCode')} required htmlFor="fp-code" help={t('auth.recoveryCodeHelp')}>
        <Input
          id="fp-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError('');
          }}
          placeholder={tx('XXXX-XXXX-XXXX')}
          autoComplete="one-time-code"
          spellCheck={false}
          style={{ fontFamily: 'var(--font-num)', letterSpacing: '0.06em' }}
        />
      </Field>

      <PinField id="fp-pin" label={t('auth.newPin')} value={pin} onChange={setPin} />
      <PinField id="fp-confirm" label={t('auth.confirmPin')} value={confirm} onChange={setConfirm} error={error} />

      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!email || !code || !pin}>
        {t('auth.setNewPin')}
      </Button>

      <button type="button" className="btn btn--ghost" onClick={onBack}>
        <Icon name="arrow-left" size={14} /> {t('auth.backToSignIn')}
      </button>

      {/* Say exactly what this build can and cannot do. */}
      <Callout tone="warn" icon="alert">
        {t('auth.emailDeliveryNote')}
      </Callout>
    </form>
  );
}

/* --------------------------------------------------- recovery code panel */

function RecoveryCodeShown({
  issued,
  onDone,
}: {
  issued: { code: string; email: string; pin: string };
  onDone: () => void;
}) {
  const { t } = usePrefs();
  const { toast, signIn } = useStore();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const code = issued.code;

  const continueIn = async () => {
    setBusy(true);
    try {
      await signIn(issued.email, issued.pin);
      onDone();
    } catch (e) {
      toast({ tone: 'error', title: (e as Error).message });
      setBusy(false);
      onDone();
    }
  };

  return (
    <div className="stack gap-4">
      <div>
        <h2 className="section-title">{t('auth.saveCodeTitle')}</h2>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
          {t('auth.saveCodeSub')}
        </p>
      </div>

      <div className="calc" style={{ alignItems: 'center', textAlign: 'center', padding: 'var(--s-5)', gap: 'var(--s-3)' }}>
        <code
          style={{
            fontFamily: 'var(--font-num)',
            fontSize: '1.375rem',
            fontWeight: 700,
            letterSpacing: '0.09em',
            color: 'var(--text)',
            wordBreak: 'break-all',
          }}
        >
          {code}
        </code>
        <Button
          variant="secondary"
          icon="file"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              toast({ tone: 'success', title: t('auth.codeCopied') });
            } catch {
              toast({ tone: 'warn', title: t('auth.copyFailed') });
            }
          }}
        >
          {t('auth.copyCode')}
        </Button>
      </div>

      <Callout tone="danger" icon="alert">
        {t('auth.codeOnceWarning')}
      </Callout>

      <label className="switch" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span className="switch__track" style={{ marginTop: 2 }} />
        <span style={{ fontSize: 'var(--fs-sm)' }}>{t('auth.confirmSaved')}</span>
      </label>

      <Button variant="primary" size="lg" block disabled={!saved} loading={busy} onClick={continueIn}>
        {t('auth.continue')}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ pin field */

function PinField({
  id,
  label,
  value,
  onChange,
  error,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  help?: string;
}) {
  const { t } = usePrefs();
  const [show, setShow] = useState(false);

  return (
    <Field label={label} required error={error} help={help} htmlFor={id}>
      <div style={{ position: 'relative' }}>
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          // Digits only: the PIN rules are numeric, so silently dropping other
          // characters is kinder than rejecting the form after the fact.
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder="••••"
          maxLength={8}
          invalid={Boolean(error)}
          style={{ paddingRight: 40, letterSpacing: show ? 'normal' : '0.2em' }}
        />
        <button
          type="button"
          className="iconbtn"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? t('login.hidePin') : t('login.showPin')}
          style={{ position: 'absolute', right: 2, top: 1, width: 34, height: 34 }}
        >
          <Icon name="eye" size={16} />
        </button>
      </div>
    </Field>
  );
}
