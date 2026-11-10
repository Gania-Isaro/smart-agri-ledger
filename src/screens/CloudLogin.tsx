/**
 * Online sign-in: the owner creates the cooperative, the manager joins it with
 * the owner's invite code, and both sign in with email and password. Records
 * then sync between their phones.
 */

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field, Input } from '../components/ui/primitives';
import { useStore } from '../state/store';
import { tx } from '../i18n/tx';
import * as cloud from '../cloud/account';

type Mode = 'signin' | 'create' | 'join' | 'forgot';

export function CloudLogin({ onUseDevice }: { onUseDevice: () => void }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  if (confirmEmail) {
    return (
      <div className="stack gap-4">
        <Callout tone="info" icon="info">
          {tx('We sent a confirmation link to {email}. Open it, then come back and sign in. Your cooperative is set up the first time you sign in.', { email: confirmEmail })}
        </Callout>
        <Button variant="primary" block onClick={() => { setConfirmEmail(null); setMode('signin'); }}>
          {tx('Go to sign in')}
        </Button>
      </div>
    );
  }

  return (
    <>
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
      {mode === 'create' && <CreateForm onConfirm={setConfirmEmail} />}
      {mode === 'join' && <JoinForm onConfirm={setConfirmEmail} />}
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

function EmailPassword({
  email,
  password,
  onEmail,
  onPassword,
  newPassword,
  invalid,
}: {
  email: string;
  password: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  newPassword?: boolean;
  invalid?: boolean;
}) {
  return (
    <>
      <Field label={tx('Email')} required>
        <Input type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => onEmail(e.target.value)} placeholder={tx('you@cooperative.rw')} invalid={invalid} />
      </Field>
      <Field label={tx('Password')} required help={newPassword ? tx('At least 6 characters.') : undefined}>
        <Input type="password" autoComplete={newPassword ? 'new-password' : 'current-password'} value={password} onChange={(e) => onPassword(e.target.value)} invalid={invalid} />
      </Field>
    </>
  );
}

function SignInForm({ onForgot }: { onForgot: () => void }) {
  const { cloudSignIn, toast } = useStore();
  const { error, setError, busy, run } = useSubmit();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="stack gap-4"
      onSubmit={(e) =>
        run(e, async () => {
          await cloudSignIn(email, password);
          toast({ tone: 'success', title: tx('Signed in') });
        })
      }
    >
      <EmailPassword email={email} password={password} onEmail={(v) => { setEmail(v); setError(''); }} onPassword={(v) => { setPassword(v); setError(''); }} invalid={Boolean(error)} />
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

function CreateForm({ onConfirm }: { onConfirm: (email: string) => void }) {
  const { cloudCreate, toast } = useStore();
  const { error, busy, run } = useSubmit();
  const [name, setName] = useState('');
  const [coop, setCoop] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="stack gap-4"
      onSubmit={(e) =>
        run(e, async () => {
          const r = await cloudCreate({ name, email, password, cooperativeName: coop });
          if (r.needsConfirmation) onConfirm(email.trim());
          else if (r.membership) {
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
      <EmailPassword email={email} password={password} onEmail={setEmail} onPassword={setPassword} newPassword />
      {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Create the cooperative')}
      </Button>
    </form>
  );
}

function JoinForm({ onConfirm }: { onConfirm: (email: string) => void }) {
  const { cloudJoin, toast } = useStore();
  const { error, busy, run } = useSubmit();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="stack gap-4"
      onSubmit={(e) =>
        run(e, async () => {
          const r = await cloudJoin({ name, email, password, code });
          if (r.needsConfirmation) onConfirm(email.trim());
          else toast({ tone: 'success', title: tx('You joined {name}', { name: r.membership?.coopName ?? '' }) });
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
      <EmailPassword email={email} password={password} onEmail={setEmail} onPassword={setPassword} newPassword />
      {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Join the cooperative')}
      </Button>
    </form>
  );
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const { error, busy, run } = useSubmit();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="stack gap-4">
        <Callout tone="info" icon="info">
          {tx('If an account exists for {email}, a link to set a new password is on its way. Open it on this phone.', { email })}
        </Callout>
        <Button variant="primary" block onClick={onBack}>
          {tx('Back to sign in')}
        </Button>
      </div>
    );
  }

  return (
    <form className="stack gap-4" onSubmit={(e) => run(e, async () => { await cloud.sendPasswordReset(email); setSent(true); })}>
      <Field label={tx('Email')} required>
        <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tx('you@cooperative.rw')} />
      </Field>
      {error && <Callout tone="danger" icon="alert">{error}</Callout>}
      <Button variant="primary" type="submit" block loading={busy}>
        {tx('Send me a reset link')}
      </Button>
      <Button variant="ghost" type="button" onClick={onBack}>
        {tx('Back to sign in')}
      </Button>
    </form>
  );
}
