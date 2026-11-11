/**
 * Online sign-in: the owner creates the cooperative, the manager joins it with
 * their group's code, and both sign in with a phone number and password.
 * Records then sync between their phones.
 */

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field, Input } from '../components/ui/primitives';
import { NOTICE_KEY, useStore } from '../state/store';
import { tx } from '../i18n/tx';
import * as cloud from '../cloud/account';

type Mode = 'signin' | 'create' | 'join' | 'forgot';

/** Why the app signed this phone out, said once on the sign-in page. */
function takeNotice(): string | null {
  try {
    const why = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return why;
  } catch {
    return null;
  }
}

export function CloudLogin({ onUseDevice }: { onUseDevice: () => void }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [notice] = useState(takeNotice);
  return (
    <>
      {notice && (
        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Callout tone="warn" icon="info">
            {notice === 'removed'
              ? tx('The owner removed you from the cooperative, so this phone was signed out.')
              : notice === 'changed'
                ? tx('Your group or role changed. Sign in again to open it.')
                : tx('Your sign-in ran out. Sign in again; your records on this phone are kept.')}
          </Callout>
        </div>
      )}
      <div className="tabs tabs--wrap" style={{ marginBottom: 'var(--s-5)' }} role="tablist">
        {([
          ['signin', tx('Sign in')],
          ['create', tx('New owner account')],
          ['join', tx('Join with a code')],
        ] as [Mode, string][]).map(([m, label]) => (
          <button
            key={m}
            className={`tab ${mode === m || (m === 'signin' && mode === 'forgot') ? 'tab--on' : ''}`}
            onClick={() => setMode(m)}
            role="tab"
            aria-selected={mode === m}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'signin' && <SignInForm onForgot={() => setMode('forgot')} />}
      {mode === 'create' && <CreateForm />}
      {mode === 'join' && <JoinForm />}
      {mode === 'forgot' && <ForgotForm onBack={() => setMode('signin')} />}

      <div className="login__demo" style={{ marginTop: 'var(--s-5)' }}>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-2)' }}>
          {tx('Only want to look around, or use the app on this phone alone?')}
        </p>
        <Button variant="ghost" onClick={onUseDevice}>
          {tx('Use without an online account')}
        </Button>
      </div>
    </>
  );
}

function useSubmit() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message || tx('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, busy, run };
}

/** Phone number (the sign-in name), an optional email, and a new password. */
function NewPersonFields({
  phone,
  email,
  password,
  onPhone,
  onEmail,
  onPassword,
}: {
  phone: string;
  email: string;
  password: string;
  onPhone: (v: string) => void;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
}) {
  return (
    <>
      <Field label={tx('Phone number')} required help={tx('You will sign in with this number.')}>
        <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="0788 123 456" />
      </Field>
      <Field label={tx('Email')} help={tx('Optional. Leave it empty if you have none.')}>
        <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => onEmail(e.target.value)} placeholder={tx('you@cooperative.rw')} />
      </Field>
      <Field label={tx('Password')} required help={tx('At least 6 characters.')}>
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => onPassword(e.target.value)} />
      </Field>
    </>
  );
}

function SignInForm({ onForgot }: { onForgot: () => void }) {
  const { cloudSignIn, toast } = useStore();
  const { error, setError, busy, run } = useSubmit();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="stack gap-4"
      onSubmit={(e) =>
        run(e, async () => {
          await cloudSignIn(login, password);
          toast({ tone: 'success', title: tx('Signed in') });
        })
      }
    >
      <Field label={tx('Phone number')} required help={tx('If you signed up with an email before, type that email here.')}>
        <Input autoComplete="username" value={login} onChange={(e) => { setLogin(e.target.value); setError(''); }} placeholder="0788 123 456" invalid={Boolean(error)} />
      </Field>
      <Field label={tx('Password')} required>
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} invalid={Boolean(error)} />
      </Field>
      {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Sign in')}
      </Button>
      <Button variant="ghost" type="button" onClick={onForgot}>
        {tx('Forgotten your password?')}
      </Button>
    </form>
  );
}

function CreateForm() {
  const { cloudCreate, toast } = useStore();
  const { error, busy, run } = useSubmit();
  const [name, setName] = useState('');
  const [coop, setCoop] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="stack gap-4"
      onSubmit={(e) =>
        run(e, async () => {
          const r = await cloudCreate({ name, phone, email, password, cooperativeName: coop });
          if (r.membership) {
            toast({
              tone: 'success',
              title: tx('Cooperative created'),
              message: tx('Next, open Workers then Groups: create your groups and give each manager their group’s code.'),
              duration: 12000,
            });
          }
        })
      }
    >
      <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
        {tx('For the owner. You create the cooperative once, then each group gets its own manager code.')}
      </p>
      <Field label={tx('Your name')} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <Field label={tx('Cooperative name')} required>
        <Input value={coop} onChange={(e) => setCoop(e.target.value)} />
      </Field>
      <NewPersonFields phone={phone} email={email} password={password} onPhone={setPhone} onEmail={setEmail} onPassword={setPassword} />
      {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Create the cooperative')}
      </Button>
    </form>
  );
}

function JoinForm() {
  const { cloudJoin, toast } = useStore();
  const { error, busy, run } = useSubmit();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="stack gap-4"
      onSubmit={(e) =>
        run(e, async () => {
          const r = await cloudJoin({ name, phone, email, password, code });
          toast({ tone: 'success', title: tx('You joined {name}', { name: r.membership?.coopName ?? '' }) });
        })
      }
    >
      <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
        {tx('For a group manager. Ask the owner for your group’s code, it looks like ABCD-1234. You will see only your group.')}
      </p>
      <Field label={tx('Invite code')} required>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-1234" autoCapitalize="characters" />
      </Field>
      <Field label={tx('Your name')} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <NewPersonFields phone={phone} email={email} password={password} onPhone={setPhone} onEmail={setEmail} onPassword={setPassword} />
      {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Join the cooperative')}
      </Button>
    </form>
  );
}

/**
 * A forgotten password. Phone accounts have no mailbox, so the password is
 * set again here with a code: a manager uses their group's code (the owner
 * reads it out), the owner uses the recovery code from when they signed up.
 * Accounts made with an email can still ask for a link.
 */
function ForgotForm({ onBack }: { onBack: () => void }) {
  const { error, setError, busy, run } = useSubmit();
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<'reset' | 'sent' | null>(null);
  const byEmail = login.includes('@');

  if (done) {
    return (
      <div className="stack gap-4">
        <Callout tone="info" icon="info">
          {done === 'reset'
            ? tx('Your new password is saved. Sign in with it now.')
            : tx('If an account exists for {email}, a link to set a new password is on its way. Open it on this phone.', { email: login.trim() })}
        </Callout>
        <Button variant="primary" block onClick={onBack}>
          {tx('Back to sign in')}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="stack gap-4"
      onSubmit={(e) =>
        run(e, async () => {
          await cloud.resetWithCode(login, code, password);
          setDone('reset');
        })
      }
    >
      <Field label={tx('Phone number')} required>
        <Input autoComplete="username" value={login} onChange={(e) => { setLogin(e.target.value); setError(''); }} placeholder="0788 123 456" />
      </Field>
      <Field
        label={tx('Code')}
        required
        help={tx('Group manager: ask the owner for your group’s manager code. Owner: the recovery code you wrote down when you created the account.')}
      >
        <Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }} autoCapitalize="characters" autoComplete="off" />
      </Field>
      <Field label={tx('New password')} required help={tx('At least 6 characters.')}>
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Save the new password')}
      </Button>
      {byEmail && (
        <Button
          variant="secondary"
          type="button"
          block
          onClick={(e) => run(e as unknown as FormEvent, async () => { await cloud.sendPasswordReset(login); setDone('sent'); })}
        >
          {tx('No code? Email me a reset link')}
        </Button>
      )}
      <Button variant="ghost" type="button" onClick={onBack}>
        {tx('Back to sign in')}
      </Button>
    </form>
  );
}
