# Pizza 42 × Auth0 — Customer Identity Architecture

Reference implementation showing how **Pizza 42**, a European pizza chain,
modernizes its customer identity with **Auth0** — replacing a brittle homegrown
sign-in with managed, standards-based identity that scales, plugs into the
existing marketing stack, and satisfies GDPR data-subject rights out of the box.

This repository contains the running sample: a Node.js/Express service that
hosts both a React-style ordering SPA and the Pizza 42 Orders API, with Auth0
as the identity provider.

---

## 1. The customer

**Pizza 42** runs **600 locations across Europe**, serving **~2 million
registered accounts** (~500k MAU). Friday and Saturday evenings (17:00–21:00 CET)
plus large televised events create traffic spikes of up to **25×** baseline.

The estate today:

- **Frontend** — a React web portal and a Flutter mobile app.
- **Backend** — Node.js microservices on AWS.
- **Identity** — a homegrown store: MySQL with salted SHA-256 hashes. Brittle,
  no OIDC, hard to scale, expensive to operate.
- **Marketing** — Braze and Segment, fed today by ad-hoc app instrumentation.

## 2. What each team needs

### Security
- Stop storing credentials. Storing them is a liability and a target.
- Layered defense against credential stuffing, bots, brute force, password
  reuse from third-party breaches — without building or operating any of it.

### Product
- A login experience that is **frictionless** (no friction the customer doesn't
  benefit from) and **customizable** (looks and feels like Pizza 42).
- A **turnkey password-reset** flow so the help desk stops handling reset
  tickets (today **35% of all support tickets** are password resets at
  **~$12 / call**).
- A **social login** option — at minimum Google, Apple, Facebook.

### Marketing
- Customer data (favourite store, last pizza ordered, frequency, lifetime
  value) flowing into **Braze and Segment** *from the login event itself*, so
  campaigns can personalise without new app instrumentation.

### Engineering & Leadership
- Get engineering off identity. It isn't Pizza 42's product; it consumes time
  that should be spent making pizza great. The platform must absorb traffic
  spikes without ops effort.

### Compliance
- **GDPR**: data-subject rights — access, rectification, erasure, portability,
  consent — exercisable by the customer self-service, not by a service desk.
- **EU data residency** for personal data (600 EU locations + EEA customer base).

### Migration constraint
- **Cannot force a password reset** on 2 million customers. Any migration has
  to be invisible and reversible.

## 3. Target architecture

```
┌──────────────────────┐        ┌──────────────────────────────┐        ┌───────────────────────┐
│  PIZZA 42 CUSTOMERS  │        │      PIZZA 42 — AWS          │        │   AUTH0 — EU TENANT   │
│                      │        │                              │        │                       │
│  React web portal    │ OIDC + │   ┌──────────────────────┐   │  JWT   │  Authorization Server │
│  Flutter mobile app  │◀──────▶│   │ Orders microservice  │   │◀──────▶│  (Universal Login)    │
│                      │  PKCE  │   │ (Node.js)            │   │ JWKS / │                       │
│  (ID + access +      │        │   └──────────────────────┘   │ RS256  │  Custom DB connection │
│   refresh tokens)    │ Bearer │   ┌──────────────────────┐   │        │  ───── login script   │
│                      │◀──────▶│   │ Loyalty/Profile svc  │   │        │  ───── get-user script│
└──────────────────────┘  JWT   │   │ (Node.js)            │   │  M2M   │                       │
                                │   └──────────────────────┘   │◀──────▶│  Management API       │
                                │                              │        │                       │
                                │   ┌──────────────────────┐   │ verify │  Post-Login Action    │
                                │   │ Legacy MySQL store   │◀──┼────────│  Attack Protection    │
                                │   │ (2M users, SHA-256)  │   │ SHA-256│  Adaptive MFA         │
                                │   │                      │   │        │  Passwordless / Passkeys│
                                │   │  retired post-cutover│   │        │  Log Streams          │
                                │   └──────────────────────┘   │        └───────────┬───────────┘
                                └──────────────────────────────┘                    │
                                                                                    │ events + traits
                                                                                    ▼
                                                                          ┌────────────────────┐
                                                                          │  Segment → Braze   │
                                                                          │  (marketing CDP)   │
                                                                          └────────────────────┘
```

**The five integration seams:**

1. **Clients ↔ Auth0** — both React and Flutter authenticate with Authorization
   Code + PKCE against the same Auth0 tenant. One identity across web and
   native, one set of users to govern, one place to enforce policy.
2. **Clients → microservices** — calls go to Node services on AWS carrying an
   Auth0-issued **JWT access token** (RS256). Each service is a resource
   server: it fetches the tenant JWKS, verifies signature + audience + issuer
   + expiry, and authorises by scope. Stateless — no per-request database
   call for auth.
3. **Auth0 Custom DB connection → legacy MySQL** — *during migration only*.
   First time a customer signs in after cutover, Auth0's Custom DB Login
   script binds to the legacy MySQL, verifies the salted SHA-256 hash, and
   migrates the user into Auth0's own store on success. From that login on,
   the user is native in Auth0; the legacy store is never touched again for
   them. **No forced password reset, no big-bang cutover.**
4. **Auth0 → Segment → Braze** — Log Streams (and Action-augmented user
   metadata) push login events with marketing-relevant traits to Segment in
   near-real-time; Segment fans out to Braze for lifecycle campaigns. The
   marketing pipeline doesn't depend on app instrumentation.
5. **Microservices → Auth0 Management API (M2M)** — administrative reads
   (profile, recent logs) and the GDPR self-service write/delete operations
   use a dedicated Machine-to-Machine client with least-privilege scopes.

## 4. How Auth0 answers each need

| Need | Auth0 capability | What changes for Pizza 42 |
|---|---|---|
| Stop storing credentials (liability) | Managed credential storage (DB connection / Passkeys / Passwordless) | Pizza 42 no longer stores or hashes passwords. The attack surface that was the homegrown MySQL goes away. |
| Defend against credential stuffing, bots, brute force, breached passwords | **Attack Protection** — Bot Detection · Suspicious-IP Throttling · Brute-force Protection · Breached-Password Detection | All four enabled as dashboard configuration, applied across every login attempt regardless of channel. |
| Frictionless login | **Passkeys / WebAuthn**, **Passwordless e-mail code** | Returning customers sign in with one tap; new customers can skip passwords entirely. |
| Customizable login | **Universal Login** + tenant Branding (logo, colours, copy); **Custom Domain + Advanced Customization (ACUL)** for full pixel control | The Auth0-hosted login looks and feels like Pizza 42 — without owning the implementation. |
| Turnkey password reset | Built-in Universal Login self-service reset | Removes the 35% / $12 reset-ticket category from the help desk. |
| Social login (Google, Apple, Facebook…) | **Social connections** + Marketplace | One-tap sign-in via the customer's existing provider; no per-provider integration work. |
| Account linking when the same customer uses both email/pw and social | **Account Linking** | A migrated email/pw customer who later signs in with Google links to a single Pizza 42 record — no duplicates. |
| Migrate 2M users with no forced reset | **Custom Database connection** with login + get-user scripts against the legacy MySQL; **import_mode** automatic migration; bulk-import API for the long tail | Customers migrate themselves on their next normal login; the legacy store is decommissioned on Pizza 42's schedule, not the customer's. Coop Norway operates the same pattern at 25× peaks with zero downtime. |
| EU data residency / GDPR | **EU regional tenant** + tenant isolation | All identity data stays in the EU; vendor inherits SOC 2 / ISO / GDPR certifications. |
| GDPR data-subject rights: access, rectification, erasure, portability, consent | **Management API** (`users.get/update/delete` + `logs.getAll`) + **Post-Login Action** + **Log Streams**, surfaced via the in-app **"Your Privacy & Data"** page — see [§7](#7-gdpr-self-service) | Customer exercises every applicable right from one screen. Audited via Log Streams. No service-desk overhead. |
| High-value transaction protection (orders over a threshold) | **Transactional step-up MFA** (`acr_values` + Action enforcement) | $260 family order triggers a passkey/OTP re-challenge; $10 pizza stays one-tap. Security exactly where the money is. |
| Marketing data → CRM at login time | **Log Streams** + **Post-Login Action** → Segment → Braze | Favourite store, last pizza ordered, lifetime value, monthly orders reach the CDP from the login event itself. No new app instrumentation. |
| Risk-based authentication | **Adaptive MFA** | Step-up only when the signal (geo, velocity, device, breached-credential) warrants it. |
| Absorb 25× spikes (Fri/Sat CET, World-Cup) without ops effort | Managed, elastic Auth0 platform (10B+ auths/month) + stateless JWT validation in the microservices | Peak load is Auth0's problem, not Pizza 42's. JWT verification is local once JWKS is cached — no per-request DB call. |
| Engineering off identity | All of the above are configuration, not code | Engineering returns to the product. |
| Visibility & audit | **Log Streams → SIEM** | Every authentication event is exportable in real time for security operations and compliance evidence. |

## 5. What's in this repository

```
pizza42-api/
├── server.js              Express server — serves the SPA and the Orders API
├── public/
│   └── index.html         Single-page ordering app + GDPR self-service page
├── package.json
├── Procfile               Heroku deploy
└── .env                   Tenant config (gitignored)
```

### `server.js` — what the API does

- **`POST /orders`** — places an order. Guarded by:
  1. JWT validation against Auth0's JWKS (signature, `aud`, `iss`, `exp`).
  2. `requiredScopes('create:orders')` — the access token must carry that
     scope.
  3. **Email-verified gate** — a custom claim from the Post-Login Action.
     Unverified customers can browse but can't order.
  4. **High-value step-up MFA** signal — orders over the configured threshold
     trigger a transactional step-up in the SPA; the API records whether MFA
     was observed on the token (`amr` / custom claim).
  After all gates pass, the order is persisted to `user_metadata.orders` via
  the Management API and the derived stats (`favouriteStore`, `lifetimeValue`,
  etc.) are recomputed.
- **`GET /orders`** — returns the calling customer's orders.
- **`GET /me`**, **`GET /me/export`**, **`PATCH /me`**, **`POST /me/consent`**,
  **`DELETE /me`** — five self-scoped GDPR self-service endpoints (Art 15 /
  16 / 17 / 20 / 7). Each reads the user id from `req.auth.payload.sub`;
  there is no URL path that names a user id, so a caller cannot act on
  someone else's record.

### `public/index.html` — what the SPA does

- Universal Login via `auth0-spa-js` (Authorization Code + PKCE).
- An ordering screen — pick store, pizza, size, crust, toppings, quantity —
  with a real-time price and a Place Order button that calls `/orders` with
  the access token. Above the threshold, `getTokenWithPopup` triggers
  transactional step-up MFA before the order is placed.
- A **"Your Privacy & Data"** page (top-right link) — see §7.

## 6. Running locally

### Prerequisites

- Node.js 22.x.
- An Auth0 tenant with:
  - A **Single-Page Application** (audience: your custom API).
  - A **Custom API** with at least the `create:orders` scope (and RBAC on if
    you want enforcement).
  - A **Machine-to-Machine application** authorised on the Auth0 Management
    API with: `read:users`, `update:users`, `delete:users`, `read:logs`
    (`read:authentication_methods` optional).
  - A Post-Login Action that promotes `email_verified` onto the access token
    and projects `user_metadata.orders / preferences / stats` onto the ID
    token under a namespaced claim (e.g. `https://pizza42.com/...`).

### Configure

```env
# .env (gitignored)
AUTH0_DOMAIN=your-tenant.eu.auth0.com
AUTH0_AUDIENCE=https://pizza42-api
AUTH0_M2M_CLIENT_ID=...
AUTH0_M2M_CLIENT_SECRET=...
PORT=3001
```

`public/index.html` carries the SPA's `domain` and `clientId` inline; edit those
to match your tenant if forking.

### Run

```powershell
npm install
npm start
```

Browse to `http://localhost:3001`, sign up or log in, place an order, and click
**Privacy & Data** in the top-right to exercise the GDPR controls.

## 7. GDPR self-service

A dedicated page at `/` (top-right **Privacy & Data** button after login)
surfaces every applicable data-subject right in one screen:

| Section | GDPR article | Implementation |
|---|---|---|
| Summary stat tiles | Art 12 (transparency) | Email, sign-in provider, orders held, total sign-ins |
| Rectification — your preferred name | **Art 16** | Writes `user_metadata.preferred_name` (always writable, regardless of connection type — the controller-owned copy, separate from upstream IdP-owned root profile) |
| Marketing consent | **Art 7** | Toggle, timestamped + IP-tagged in `user_metadata.marketing_consent`; the Management API update itself is captured by Log Streams as the audit trail |
| Portability — download my data | **Art 20** | `Content-Disposition: attachment` JSON labelled with `gdpr_article` |
| Recent sign-ins | **Art 15** | Last 10 entries from `logs.getAll({ q: "user_id:..." })` |
| Right to erasure — danger zone | **Art 17** | `users.delete({ id: req.auth.payload.sub })` after explicit `DELETE` confirmation; UI clearly states that records retained under another lawful basis (tax / dispute — Art 17(3)) are not touched |

Every endpoint is **self-scoped** to the caller's `sub` — by construction, a
customer can only act on their own record.

## 8. Production hardening notes

The code here is a faithful sample architecture; for a real Pizza 42
deployment the following are standard hardening steps:

- **Two M2M applications**, not one: one for the orders flow (`update:users`),
  one for the privacy-self-service flow (`delete:users`, `read:logs`). Least
  privilege per service.
- **Challenge-flow Action** for transactional step-up so the MFA claim lands
  in the same access token the API gates on, enabling a strict server-side
  gate (rather than the record-and-observe pattern used here, where the SPA
  fires the real challenge and the API records the signal).
- **Custom Domain** (`login.pizza42.com`) for branded login and to bind
  passkeys to a first-party origin.
- **Auth0 Forms** for fine-grained consent capture (multiple purposes, full
  withdrawal trail), replacing the single marketing toggle for production
  use.
- **Tenant separation** for dev / staging / prod, ideally provisioned via
  Terraform (the Auth0 Terraform provider supports the full Management API).
- **Log Streams** to the production SIEM (e.g. Datadog, Splunk, Sumo Logic,
  or an S3 sink in the same EU region) — the webhook sink shown here is
  the demo configuration.

## 9. Why this architecture

In one paragraph: Pizza 42 makes pizza, not authentication systems. Every
identity capability shown above — modern protocols, breach-grade defenses,
risk-based MFA, passkeys, federation, lazy migration from a legacy store,
real-time event activation to the marketing stack, customer-facing GDPR
self-service, EU residency — is **configuration** on a managed platform that
Auth0 already runs at scale. Pizza 42's engineering writes the pizza
microservices and the customer-facing UI, validates JWTs the platform issues,
and ships product. That is the only sustainable split for a brand whose core
value isn't identity.

---

**Tech:** Node.js 22 · Express · `express-oauth2-jwt-bearer` · `auth0` SDK v4 ·
`@auth0/auth0-spa-js` · plain HTML/CSS/JS for the SPA · Heroku for hosting.
