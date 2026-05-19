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

async function getUserMetadata(sub) {
  const { data } = await management.users.get({ id: sub });
  return data.user_metadata ?? {};
}

// Behavioral enrichment derived from the full order history. This is the
// "data drives marketing" artifact: favorite topping/size, lifetime value.
function computeStats(orders) {
  const mode = (counts) =>
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const pizzaCounts = {};
  const toppingCounts = {};
  const sizeCounts = {};
  const crustCounts = {};
  let lifetimeValue = 0;
  for (const o of orders) {
    lifetimeValue += o.total || 0;
    if (o.pizza) pizzaCounts[o.pizza] = (pizzaCounts[o.pizza] || 0) + 1;
    (o.toppings || []).forEach((t) => { toppingCounts[t] = (toppingCounts[t] || 0) + 1; });
    if (o.size) sizeCounts[o.size] = (sizeCounts[o.size] || 0) + 1;
    if (o.crust) crustCounts[o.crust] = (crustCounts[o.crust] || 0) + 1;
  }
  return {
    totalOrders: orders.length,
    lifetimeValue: Math.round(lifetimeValue * 100) / 100,
    favoritePizza: mode(pizzaCounts),
    favoriteSize: mode(sizeCounts),
    favoriteCrust: mode(crustCounts),
    favoriteTopping: mode(toppingCounts),
  };
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

    // Defense in depth: high-value orders must have been authenticated with
    // MFA. The Post-Login Action stamps the auth methods onto the access
    // token; we enforce it server-side so the rule can't be bypassed in the UI.
    const HIGH_VALUE = 250;
    const orderTotal = req.body.total ?? 0;
    if (orderTotal > HIGH_VALUE) {
      const mfaDone =
        req.auth.payload['https://pizza42.com/mfa'] === true ||
        (req.auth.payload['https://pizza42.com/amr'] || []).includes('mfa');
      if (!mfaDone) {
        return res.status(403).json({
          error: 'mfa_required',
          message:
            'Step-up verification was not completed for this $' +
            orderTotal +
            ' order. Please finish the MFA challenge at checkout and retry.',
        });
      }
    }

    const order = {
      id: `order_${Date.now()}`,
      pizza: req.body.pizza ?? 'Margherita',
      size: req.body.size ?? 'Personal',
      crust: req.body.crust ?? 'Thin',
      toppings: req.body.toppings ?? [],
      quantity: req.body.quantity ?? 1,
      total: orderTotal,
      createdAt: new Date().toISOString(),
    };

    // Read existing metadata first so we merge (never clobber other keys).
    const meta = await getUserMetadata(sub);
    const orders = [...(meta.orders ?? []), order];
    const preferences = {
      lastPizza: order.pizza,
      lastSize: order.size,
      lastCrust: order.crust,
      lastToppings: order.toppings,
    };
    const stats = computeStats(orders);

    await management.users.update(
      { id: sub },
      { user_metadata: { ...meta, orders, preferences, stats } }
    );

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

app.get('/orders', checkJwt, async (req, res, next) => {
  try {
    const meta = await getUserMetadata(req.auth.payload.sub);
    res.json(meta.orders ?? []);
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
