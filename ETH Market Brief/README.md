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

# Circle Agent Wallet path
SELAT_SIGNER_ADDRESS=0x...
CIRCLE_CLI_COMMAND=/absolute/path/to/circle

# Local private-key demo path
X402_CLIENT_PRIVATE_KEY=

# Optional remote signer path
SELAT_SIGNER_API_URL=
```

The demo redacts payment signatures before returning capture data to the browser. It shows a signature digest for correlation and redacts nested signature-like fields in decoded payloads.

