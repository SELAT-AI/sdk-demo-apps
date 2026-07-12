# SELAT signing service

A tiny hosted remote signer for SELAT **Circle Agent Wallets**.

The Agent Wallet path signs by shelling out to the local `circle` CLI, which
cannot run in a serverless function (no binary, no `circle login` session, a
read-only filesystem). This service runs the CLI on a **long-lived host** and
exposes one HTTP endpoint, so serverless apps (e.g. the [ETH Market
Brief](../eth-market-brief) demo on Vercel) can delegate signing to it via the
SDK's `createHttpRemoteSigner`.

```
  Vercel (serverless)                     This service (long-lived host)
  ┌───────────────────────────┐           ┌──────────────────────────────┐
  │ createHttpRemoteSigner     │  POST     │ POST /sign                   │
  │   { address, typedData } ──┼──────────▶│   → circle wallet sign ...   │
  │   ◀── { signature }        │  Bearer   │   → { signature }            │
  └───────────────────────────┘  token     └──────────────────────────────┘
                                              needs authenticated Circle CLI
```

## API

### `POST /sign`

Headers: `Authorization: Bearer <SIGNER_API_TOKEN>`, `Content-Type: application/json`

```jsonc
// request
{ "address": "0x<agent-wallet>", "typedData": { /* EIP-712 */ } }
// 200
{ "signature": "0x..." }
```

Responses: `401` (bad/missing token), `400` (bad JSON, wrong/missing address,
missing `typedData`), `413` (body too large), `502` (CLI signing failed —
usually the CLI is not authenticated). The service only ever signs for its
configured `CIRCLE_SIGNER_ADDRESS`; an address in the request that does not match
is rejected.

### `GET /health`

`200 { "ok": true }` — unauthenticated, for load-balancer health checks.

## Configuration

Copy `.env.example` to `.env` and set:

| Var | Required | Notes |
| --- | --- | --- |
| `SIGNER_API_TOKEN` | yes | Shared secret; must equal the demo's `SELAT_SIGNER_API_TOKEN`. The service refuses to start without it. |
| `CIRCLE_SIGNER_ADDRESS` | yes | The Agent Wallet address; must equal the demo's `SELAT_SIGNER_ADDRESS`. |
| `CIRCLE_SIGNER_CHAIN` | no | Default `base`. |
| `PORT` | no | Default `8787`. |
| `MAX_BODY_BYTES` | no | Default `1048576` (1 MiB). |

## Run locally

```bash
npm install
cp .env.example .env   # fill in SIGNER_API_TOKEN + CIRCLE_SIGNER_ADDRESS
npm run dev            # or: npm run build && npm start
```

## Authenticating the Circle CLI

This service signs through `@circle-fin/cli`, which must be **installed and
authenticated on the host**:

1. `@circle-fin/cli` is a dependency, so it is installed with `npm install`.
2. Authenticate once on the host (interactive): `npx circle login` and select
   the agent wallet's organization. This writes a session to the CLI's config
   directory (the user's home dir).
3. Verify: `npx circle wallet list --chain BASE` should show your wallet.

In a container, that session must persist — mount the Circle CLI config
directory as a volume, or run `circle login` into a persistent volume. An
unauthenticated CLI causes `/sign` to return `502`.

> The private signing key never leaves Circle's custody; this service only
> invokes the CLI, which authenticates with Circle's backend using the host's
> session.

## Deploy

Any platform that runs a long-lived Node process and lets you persist/auth the
Circle CLI works (a VM, Fly.io, Railway, Render, a container host). **Do not**
deploy this to a serverless platform — that reintroduces the exact problem it
solves. A `Dockerfile` is included.

## Wire up the demo

In the Vercel project for [`eth-market-brief`](../eth-market-brief), set:

```bash
SELAT_SIGNER_ADDRESS=0xb291279be48742f0a1e9ed15c8d6d2d09ea9e4da   # == CIRCLE_SIGNER_ADDRESS here
SELAT_SIGNER_API_URL=https://<this-host>/sign
SELAT_SIGNER_API_TOKEN=<same as SIGNER_API_TOKEN>
```

## Security notes

- Always terminate TLS in front of this service (platform or reverse proxy);
  the bearer token and signed payloads must not travel in clear text.
- The token is compared in constant time. Rotate it by updating both sides.
- Restrict network ingress to your app's egress where possible.
- Consider adding rate limiting at your proxy/load balancer.
