# ETH Market Brief

A consumer-facing SELAT Router SDK demo that builds an ETH market brief across paid API rails.

The workflow uses:

- Agentic Market x402 endpoints for catalyst research and ETH quote context
- MPP endpoints for Nansen smart-money flow and paid email delivery
- A server-side Circle Agent Wallet signer so signer material never reaches the browser
- A redacted offchain payload audit trail for generated `PAYMENT-SIGNATURE` metadata

## Run Locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000/demo`.

## Environment

Set one signer path in `.env.local`:

```bash
SELAT_CHAIN=base
SELAT_ROUTER_URL=https://router.selat.ai

# Circle Agent Wallet path — LOCAL ONLY (signs via the local `circle` CLI)
SELAT_SIGNER_ADDRESS=0x...

# Circle Agent Wallet path on Vercel / serverless (delegated remote signing)
SELAT_SIGNER_API_URL=
SELAT_SIGNER_API_TOKEN=

# Local private-key demo path
X402_CLIENT_PRIVATE_KEY=
```

### Choosing a signer path

The signer is resolved in this order:

1. **Remote signer (`SELAT_SIGNER_ADDRESS` + `SELAT_SIGNER_API_URL`)** — the only Circle Agent Wallet path that works on Vercel. Signing is delegated over HTTP to a service you host where the Circle CLI / Agent Wallet credentials live. The service must accept `POST { address, typedData }` and return `{ signature }`, signing with the key that recovers to `SELAT_SIGNER_ADDRESS`. Optionally protect it with `SELAT_SIGNER_API_TOKEN` (sent as `Authorization: Bearer …`).
2. **Local Circle CLI (`SELAT_SIGNER_ADDRESS` only)** — signs by spawning the local `circle` CLI, which must be installed and authenticated (`circle login`). **This path does not work on Vercel** — the CLI binary and its login session do not exist in a serverless function. When detected on Vercel, the demo returns a `501` with setup guidance instead of failing with an opaque `500`.
3. **Local private key (`X402_CLIENT_PRIVATE_KEY`)** — fully serverless-compatible in-process signing for quick demos. Not the Circle Agent Wallet custody model.

> **Deploying on Vercel?** Use path 1 (remote signer) or path 3 (private key). Path 2 is for local development only.

The demo redacts payment signatures before returning capture data to the browser. It shows a signature digest for correlation and redacts nested signature-like fields in decoded payloads.

