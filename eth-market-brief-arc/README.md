# ETH Market Brief — Arc (private key)

A consumer-facing SELAT Router SDK demo that builds an ETH market brief across
paid API rails, funded from a **Circle Gateway balance on Arc mainnet** and
signed in-process with a **private key**.

This is the private-key counterpart to [`eth-market-brief`](../eth-market-brief).
It signs every Gateway-batched payment locally with `createViemSigner`, so it
needs **no Circle CLI and no signing service** and deploys to Vercel as-is.

The workflow uses:

- Agentic Market x402 endpoints for catalyst research and ETH quote context
- MPP endpoints for Nansen smart-money flow and paid email delivery
- In-process private-key signing (`createViemSigner`) — the depositor EOA's key
- A redacted offchain payload audit trail for generated `PAYMENT-SIGNATURE` metadata

## How payments are funded

Each paid call is a Circle Gateway-batched authorization signed by the depositor
EOA's key and settled from that wallet's **Gateway balance on Arc** (chainId
5042). The EOA must have a funded Gateway balance on Arc.

## Run Locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000/demo`.

## Environment

```bash
SELAT_CHAIN=arc
SELAT_ROUTER_URL=https://router.selat.ai

# Private key of the EOA that is the Arc Gateway depositor wallet.
X402_CLIENT_PRIVATE_KEY=0x...
```

- **`X402_CLIENT_PRIVATE_KEY`** — the depositor EOA's private key. Signs every
  payment in-process. **Secret**: keep it in `.env.local` (gitignored) for local
  dev and in your Vercel project's Environment Variables for production. Never
  commit it.
- **`SELAT_CHAIN`** — `arc` (the default for this app).

> **Deploying on Vercel?** This variant works out of the box — private-key
> signing runs in the serverless function with no extra infrastructure. Just set
> `X402_CLIENT_PRIVATE_KEY` (and `SELAT_CHAIN=arc`) in the project's env vars.

The demo redacts payment signatures before returning capture data to the
browser. It shows a signature digest for correlation and redacts nested
signature-like fields in decoded payloads.
