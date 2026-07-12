import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createCircleAgentWalletSigner } from "@selat-ai/router-client";
import { loadConfig } from "./config.js";

const config = loadConfig();

// Construct the signer once. createCircleAgentWalletSigner shells out to the
// Circle CLI, so this host must have @circle-fin/cli installed and an
// authenticated session (`circle login`). Construction only resolves the CLI
// command; the CLI is not spawned until a signature is requested.
const signer = createCircleAgentWalletSigner({
  address: config.address,
  chain: config.chain
});

type SignRequest = { address?: unknown; typedData?: unknown };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

/** Constant-time bearer-token check that never short-circuits on length. */
function isAuthorized(header: string | undefined): boolean {
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(config.token);
  if (provided.length !== expected.length) {
    // Compare against a copy of `provided` so timing does not reveal the length.
    timingSafeEqual(provided, provided);
    return false;
  }
  return timingSafeEqual(provided, expected);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleSign(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAuthorized(req.headers.authorization)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let raw: string;
  try {
    raw = await readBody(req, config.maxBodyBytes);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 400;
    return sendJson(res, status, { error: status === 413 ? "Payload too large" : "Bad request" });
  }

  let body: SignRequest;
  try {
    body = JSON.parse(raw) as SignRequest;
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  // Only ever sign for this service's configured wallet — never an
  // attacker-supplied address.
  if (typeof body.address !== "string" || body.address.toLowerCase() !== config.address) {
    return sendJson(res, 400, { error: "Request address does not match this signer" });
  }
  if (!body.typedData || typeof body.typedData !== "object") {
    return sendJson(res, 400, { error: "Missing typedData" });
  }

  try {
    const signature = await signer.signTypedData(
      body.typedData as Parameters<typeof signer.signTypedData>[0]
    );
    return sendJson(res, 200, { signature });
  } catch (error) {
    // Log server-side; do not leak CLI internals to the caller.
    console.error("[signing-service] signing failed:", error instanceof Error ? error.message : error);
    return sendJson(res, 502, { error: "Signing failed" });
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET" && path === "/health") {
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && path === "/sign") {
    void handleSign(req, res);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
});

server.listen(config.port, () => {
  console.log(
    `[signing-service] listening on :${config.port} — signing for ${config.address} on ${config.chain}`
  );
});
