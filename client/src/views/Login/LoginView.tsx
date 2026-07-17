/** Simple account login (users.config.json — no Cognito). The server sets an
 * axiom_token cookie; we mirror it into localStorage for the api header. */
import { useState } from 'react';
import { C, sans, serif } from '../../theme/tokens';

export function LoginView({ onSignedIn }: { onSignedIn: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = (await res.json()) as { ok?: boolean; token?: string; username?: string; error?: string };
      if (!res.ok || !body.token) {
        setError(body.error ?? 'sign-in failed');
        return;
      }
      localStorage.setItem('axiom_token', body.token);
      onSignedIn(body.username ?? username);
    } catch {
      setError('sign-in failed — is the server reachable?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center" style={{ background: C.bg }}>
      <div className="rounded-2xl p-8 w-full" style={{ maxWidth: 360, background: C.panel, border: `1px solid ${C.border}` }}>
        <div className="mb-6 text-center">
          <span style={{ fontFamily: serif, fontSize: 28, color: C.text }}>Axiom</span>
          <p className="text-sm mt-1" style={{ color: C.sub, fontFamily: sans }}>
            Sign in to your workspace
          </p>
        </div>
        <label className="block mb-3">
          <span className="block text-xs mb-1" style={{ color: C.mute, fontFamily: sans }}>Username</span>
          <input
            data-testid="login-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontFamily: sans }}
          />
        </label>
        <label className="block mb-4">
          <span className="block text-xs mb-1" style={{ color: C.mute, fontFamily: sans }}>Password</span>
          <input
            data-testid="login-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontFamily: sans }}
          />
        </label>
        {error ? (
          <p className="text-xs mb-3" style={{ color: C.amber, fontFamily: sans }}>{error}</p>
        ) : null}
        <button
          data-testid="login-submit"
          onClick={() => void submit()}
          disabled={busy || !username || !password}
          className="w-full py-2 rounded-lg text-sm font-medium"
          style={{ background: C.accent, color: C.accentContrast, fontFamily: sans, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
