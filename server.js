import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { auth, requiredScopes } from 'express-oauth2-jwt-bearer';
import { ManagementClient } from 'auth0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  AUTH0_DOMAIN,
  AUTH0_AUDIENCE,
  AUTH0_M2M_CLIENT_ID,
  AUTH0_M2M_CLIENT_SECRET,
  SPA_ORIGIN,
  PORT = 3001,
} = process.env;

for (const k of ['AUTH0_DOMAIN', 'AUTH0_AUDIENCE', 'AUTH0_M2M_CLIENT_ID', 'AUTH0_M2M_CLIENT_SECRET']) {
  if (!process.env[k]) {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const app = express();

// CORS only matters when the SPA is served from a different origin (local dev
// with http-server on :3000). In production Express serves the SPA itself, so
// requests are same-origin and CORS never fires.
if (SPA_ORIGIN) {
  app.use(cors({ origin: SPA_ORIGIN, credentials: false }));
}
app.use(express.json());

// Serve the SPA (static index.html) from /public at the app root.
app.use(express.static(path.join(__dirname, 'public')));

const checkJwt = auth({
  audience: AUTH0_AUDIENCE,
  issuerBaseURL: `https://${AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256',
});

const management = new ManagementClient({
  domain: AUTH0_DOMAIN,
  clientId: AUTH0_M2M_CLIENT_ID,
  clientSecret: AUTH0_M2M_CLIENT_SECRET,
});

app.get('/health', (_req, res) => res.json({ ok: true }));

async function getUserOrders(sub) {
  const { data } = await management.users.get({ id: sub });
  return data.user_metadata?.orders ?? [];
}

app.post('/orders', checkJwt, requiredScopes('create:orders'), async (req, res, next) => {
  try {
    const sub = req.auth.payload.sub;
    const emailVerified = req.auth.payload['https://pizza42.com/email_verified'];
    if (emailVerified !== true) {
      return res.status(403).json({
        error: 'email_not_verified',
        message: 'Please verify your email address before placing an order.',
      });
    }

    const order = {
      id: `order_${Date.now()}`,
      items: req.body.items ?? [],
      total: req.body.total ?? 0,
      createdAt: new Date().toISOString(),
    };

    const existing = await getUserOrders(sub);
    const updated = [...existing, order];
    await management.users.update({ id: sub }, { user_metadata: { orders: updated } });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

app.get('/orders', checkJwt, async (req, res, next) => {
  try {
    const orders = await getUserOrders(req.auth.payload.sub);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err.name, err.message);
  if (err.name === 'UnauthorizedError' || err.status === 401) {
    return res.status(401).json({ error: 'unauthorized', message: err.message });
  }
  if (err.status === 403) {
    return res.status(403).json({ error: 'forbidden', message: err.message });
  }
  res.status(500).json({ error: 'server_error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`Pizza 42 app listening on port ${PORT}`);
});
