import { createCircleAgentWalletSigner } from "@selat-ai/router-client";

type Chain = Parameters<typeof createCircleAgentWalletSigner>[0]["chain"];

export type Config = {
  port: number;
  token: string;
  address: `0x${string}`;
  chain: Chain;
  maxBodyBytes: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail closed: a signing service must never run without auth or a wallet.
    console.error(`[signing-service] missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

export function loadConfig(): Config {
  const address = required("CIRCLE_SIGNER_ADDRESS").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    console.error("[signing-service] CIRCLE_SIGNER_ADDRESS must be a 0x-prefixed 20-byte address");
    process.exit(1);
  }

  return {
    port: Number(process.env.PORT ?? 8787),
    token: required("SIGNER_API_TOKEN"),
    address: address as `0x${string}`,
    chain: (process.env.CIRCLE_SIGNER_CHAIN ?? "base") as Chain,
    maxBodyBytes: Number(process.env.MAX_BODY_BYTES ?? 1_048_576) // 1 MiB
  };
}
