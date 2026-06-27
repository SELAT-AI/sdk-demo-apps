# ETH Market Brief

A consumer-facing SELAT Router SDK demo that builds an ETH market brief across paid API rails.

The workflow uses:

- Agentic Market x402 endpoints for catalyst research and ETH quote context
- MPP endpoints for Nansen smart-money flow and paid email delivery
- A server-side Circle developer-controlled wallet signer so signer material never reaches the browser
- A redacted offchain payload audit trail for generated `PAYMENT-SIGNATURE` metadata
- An admin area (`/admin`) for funding the wallet's Gateway balance via Eco gasless deposits

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

# Circle developer-controlled wallet (recommended — works locally and on Vercel)
SELAT_SIGNER_ADDRESS=0x...
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_ID=

# Local private-key demo path
X402_CLIENT_PRIVATE_KEY=
```

### Choosing a signer path

The signer is resolved in this order:

1. **Circle developer-controlled wallet (`SELAT_SIGNER_ADDRESS` + `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` + `CIRCLE_WALLET_ID`)** — the recommended path. The demo signs each EIP-712 payment authorization through Circle's API (`POST /v1/w3s/developer/sign/typedData`) via the official `@circle-fin/developer-controlled-wallets` SDK, which encrypts your entity secret into a fresh, single-use ciphertext on every request. Because it is a pure HTTPS call, it works locally **and** on Vercel / any serverless platform with no extra infrastructure — there is no `circle` CLI to install and no signing service to host. The API key and entity secret stay on the server; the browser never sees signer material. For Gateway-batched payments the wallet is a smart-contract account, so the signer transparently resolves the account's owner address (via a zero-value probe signature) before authorizing payments — so both EOA and smart-contract-account wallets work.
2. **Local private key (`X402_CLIENT_PRIVATE_KEY`)** — fully serverless-compatible in-process signing for quick demos. Not the Circle custody model.

> **Set up a Circle developer-controlled wallet:** create an API key, register an [entity secret](https://developers.circle.com/wallets/dev-controlled), and create a wallet in the [Circle console](https://developers.circle.com/wallets/dev-controlled). Use the wallet's id for `CIRCLE_WALLET_ID` and its on-chain address for `SELAT_SIGNER_ADDRESS`.

The demo redacts payment signatures before returning capture data to the browser. It shows a signature digest for correlation and redacts nested signature-like fields in decoded payloads.

### Gateway activity panel

The Gateway panel reads the wallet's unified USDC balance from Circle's [Gateway balances API](https://developers.circle.com/api-reference/gateway/all/get-token-balances) (`POST https://gateway-api.circle.com/v1/balances`, unauthenticated) and lists the contract-execution transactions that paid for each call via the wallets SDK's `listTransactions` (`CIRCLE_API_KEY` + `CIRCLE_WALLET_ID`). Both are pure HTTPS calls — no `circle` CLI — so this panel works on Vercel too.

## Admin area & Gateway funding

`/demo` is public; funding the wallet's Gateway balance lives behind a password-gated admin area at **`/admin`**.

- **Login** — set `ADMIN_PASSWORD` to enable it. A correct password mints a short-lived, HMAC-signed, httpOnly session cookie (signed with `ADMIN_SESSION_SECRET`, which defaults to `ADMIN_PASSWORD`). No database or external auth dependency.
- **Deposit** — the admin enters a USDC amount, and the server funds the wallet's Circle Gateway balance using [Eco's gasless Gateway Fast Deposits](https://docs.eco.com/addresses/gateway-fast-deposits):
  1. `POST https://api.eco.com/circle-gateway/v2/depositAddresses` returns a deterministic vault address, a quoted amount, and a deadline.
  2. The demo signs a USDC ERC-3009 `transferWithAuthorization` (wallet → vault) with the developer-controlled wallet via Circle's API — **the wallet pays no gas, it only signs**.
  3. `POST https://api.eco.com/circle-gateway/v1/gasless/transferWithAuthorization` hands the signed authorization to Eco's relayer, which pulls the USDC and settles it into Circle Gateway. The admin UI then polls vault status until `PUBLISHED`.

Both steps are pure HTTPS — no gas, no CLI, Vercel-ready. Eco fast deposits are live from **Base, Optimism, and Arbitrum**, so `SELAT_CHAIN` must be one of those. Because ERC-3009 verifies an ECDSA signature recovered to the sender, **the developer-controlled wallet must be an EOA** (the deposit route checks this and that the wallet address matches `SELAT_SIGNER_ADDRESS` before signing). Set `ECO_DAPP_ID` to attribute deposits to your dApp.

