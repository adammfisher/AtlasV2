/**
 * Simple account auth (no Cognito, per design): users.config.json defines the
 * three accounts; login returns a stateless HMAC token the client stores and
 * sends as Authorization (and mirrors into a cookie so raw fetch/EventSource
 * paths ride along). Every account is a fully separate workspace.
 */
import { Router } from 'express';
import { checkLogin, issueToken, currentAccount, allowedModels } from '../lib/account.js';

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
    res.setHeader(
      'Set-Cookie',
      `atlas_token=${token}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax`,
    );
    res.json({ ok: true, token, username: acct.username, models: acct.models });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

/** Who am I + what can I use (drives the client's model picker). */
authRouter.get('/me', (_req, res) => {
  res.json({ username: currentAccount(), models: allowedModels() });
});
