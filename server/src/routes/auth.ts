/**
 * Simple account auth (no Cognito, per design): users.config.json defines the
 * three accounts; login returns a stateless HMAC token the client stores and
 * sends as Authorization (and mirrors into a cookie so raw fetch/EventSource
 * paths ride along). Every account is a fully separate workspace.
 */
import { Router } from 'express';
import { checkLogin, issueToken, currentAccount, allowedModels, TOKEN_TTL_MS } from '../lib/account.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  void (async () => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }
    const acct = checkLogin(username.trim().toLowerCase(), password);
    if (!acct) {
      res.status(401).json({ error: 'invalid username or password' });
      return;
    }
    const token = await issueToken(acct.username);
    // cookie lifespan matches the token TTL (12h) — the token expiry is the
    // real enforcement; the cookie Max-Age just avoids sending a dead one
    res.setHeader('Set-Cookie', `axiom_token=${token}; Path=/; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}; SameSite=Lax`);
    res.json({ ok: true, token, username: acct.username, models: acct.models, expiresInMs: TOKEN_TTL_MS });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Sign out: clear the cookie. The token is stateless, so the client also
 * drops its stored copy — there's no server session to invalidate. */
authRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'axiom_token=; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

/** Who am I + what can I use (drives the footer + model picker). */
authRouter.get('/me', (_req, res) => {
  res.json({ username: currentAccount(), models: allowedModels(), ttlMs: TOKEN_TTL_MS });
});
