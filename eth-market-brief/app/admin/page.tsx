"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type SessionState = {
  adminConfigured: boolean;
  authenticated: boolean;
};

type DepositConfig = {
  chain: string;
  chainSupported: boolean;
  supportedChains: string[];
  walletAddress: string | null;
  ready: boolean;
  setup?: string;
};

type DepositResult = {
  jobId: string;
  status: string;
  vaultAddress: string;
  amount: string;
  deadline: number;
  chainId: number;
  sourceChain: string;
};

type VaultStatus = {
  state?: string;
  amount?: string;
  deadline?: number;
  intentHash?: string;
  vaultAddress?: string;
};

const TERMINAL_STATES = new Set([
  "PUBLISHED",
  "EXPIRED_UNFUNDED",
  "FAILED",
  "REFUNDED_BY_USER",
  "RECOVERY_PUBLISHED"
]);

function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function formatUsdc(baseUnits: string) {
  try {
    const value = Number(BigInt(baseUnits)) / 1_000_000;
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;
  } catch {
    return `${baseUnits} (base units)`;
  }
}

export default function AdminPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);

  const [config, setConfig] = useState<DepositConfig | null>(null);
  const [amount, setAmount] = useState("");
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositPending, setDepositPending] = useState(false);
  const [deposit, setDeposit] = useState<DepositResult | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConfig = useCallback(async () => {
    const response = await fetch("/api/admin/gateway-deposit", { cache: "no-store" });
    if (response.ok) {
      setConfig((await response.json()) as DepositConfig);
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((state: SessionState) => {
        setSession(state);
        if (state.authenticated) {
          void loadConfig();
        }
      })
      .catch(() => setSession({ adminConfigured: false, authenticated: false }));
  }, [loadConfig]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoginError(null);
    setLoginPending(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error ?? "Login failed.");
      }

      setPassword("");
      setSession({ adminConfigured: true, authenticated: true });
      void loadConfig();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoginPending(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    if (pollRef.current) {
      clearTimeout(pollRef.current);
    }
    setSession({ adminConfigured: true, authenticated: false });
    setConfig(null);
    setDeposit(null);
    setVaultStatus(null);
  }

  const pollVault = useCallback(async (vaultAddress: string) => {
    try {
      const response = await fetch(
        `/api/admin/gateway-deposit?vault=${encodeURIComponent(vaultAddress)}`,
        { cache: "no-store" }
      );
      if (response.ok) {
        const json = await response.json();
        const status = (json.status ?? {}) as VaultStatus;
        setVaultStatus(status);
        if (status.state && TERMINAL_STATES.has(status.state.toUpperCase())) {
          return;
        }
      }
    } catch {
      // transient — keep polling
    }

    pollRef.current = setTimeout(() => void pollVault(vaultAddress), 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
      }
    };
  }, []);

  async function handleDeposit(event: React.FormEvent) {
    event.preventDefault();
    setDepositError(null);
    setDepositPending(true);
    setDeposit(null);
    setVaultStatus(null);
    if (pollRef.current) {
      clearTimeout(pollRef.current);
    }

    try {
      const response = await fetch("/api/admin/gateway-deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount })
      });
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error ?? "Deposit failed.");
      }

      const result = json.deposit as DepositResult;
      setDeposit(result);
      setVaultStatus({ state: result.status });
      void pollVault(result.vaultAddress);
    } catch (error) {
      setDepositError(error instanceof Error ? error.message : "Deposit failed.");
    } finally {
      setDepositPending(false);
    }
  }

  const currentState = vaultStatus?.state?.toUpperCase();
  const isSuccess = currentState === "PUBLISHED";
  const isTerminal = currentState ? TERMINAL_STATES.has(currentState) : false;

  return (
    <main className="admin-shell">
      <style>{styles}</style>

      <header className="admin-head">
        <div>
          <p className="admin-eyebrow">SELAT · Admin</p>
          <h1>Gateway funding</h1>
        </div>
        <Link className="admin-link" href="/demo">
          ← Back to demo
        </Link>
      </header>

      {session === null ? (
        <p className="admin-muted">Loading…</p>
      ) : !session.adminConfigured ? (
        <section className="admin-card">
          <h2>Admin area is not configured</h2>
          <p className="admin-muted">
            Set <code>ADMIN_PASSWORD</code> in <code>.env.local</code> to enable admin login.
          </p>
        </section>
      ) : !session.authenticated ? (
        <section className="admin-card">
          <h2>Admin login</h2>
          <form className="admin-form" onSubmit={handleLogin}>
            <label className="admin-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin password"
                required
              />
            </label>
            {loginError ? <p className="admin-error">{loginError}</p> : null}
            <button className="admin-button" type="submit" disabled={loginPending || !password}>
              {loginPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      ) : (
        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Deposit USDC into Circle Gateway</h2>
            <button className="admin-text-button" type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>

          <p className="admin-muted">
            Signs a gasless USDC{" "}
            <code>transferWithAuthorization</code> with the developer-controlled wallet and routes
            it into Circle Gateway via Eco — the wallet pays no gas.
          </p>

          {config ? (
            <dl className="admin-meta">
              <div>
                <dt>Source chain</dt>
                <dd>{config.chain}</dd>
              </div>
              <div>
                <dt>Wallet (depositor)</dt>
                <dd>{config.walletAddress ? shortAddress(config.walletAddress) : "—"}</dd>
              </div>
            </dl>
          ) : null}

          {config && !config.ready ? (
            <p className="admin-error">{config.setup ?? "Deposit is not configured."}</p>
          ) : null}

          <form className="admin-form" onSubmit={handleDeposit}>
            <label className="admin-field">
              <span>Amount (USDC)</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="1.5"
                disabled={!config?.ready}
                required
              />
            </label>
            {depositError ? <p className="admin-error">{depositError}</p> : null}
            <button
              className="admin-button"
              type="submit"
              disabled={depositPending || !config?.ready || !amount}
            >
              {depositPending ? "Submitting…" : "Deposit to Gateway"}
            </button>
          </form>

          {deposit ? (
            <div className="admin-result">
              <div className="admin-result-head">
                <strong>Deposit submitted</strong>
                <span className={`admin-badge ${isSuccess ? "ok" : isTerminal ? "warn" : "pending"}`}>
                  {currentState ?? deposit.status}
                </span>
              </div>
              <dl className="admin-meta">
                <div>
                  <dt>Amount</dt>
                  <dd>{formatUsdc(deposit.amount)}</dd>
                </div>
                <div>
                  <dt>Vault</dt>
                  <dd>{shortAddress(deposit.vaultAddress)}</dd>
                </div>
                <div>
                  <dt>Job id</dt>
                  <dd>{deposit.jobId}</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{new Date(deposit.deadline * 1000).toLocaleString()}</dd>
                </div>
              </dl>
              <p className="admin-muted">
                {isSuccess
                  ? "Funds credited to the Gateway balance. The demo can now route paid API calls."
                  : isTerminal
                    ? "Deposit reached a terminal state without crediting. Check the amount and wallet balance."
                    : "Waiting for Eco to detect funding and publish the intent…"}
              </p>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}

const styles = `
.admin-shell {
  width: min(640px, calc(100% - 48px));
  margin: 0 auto;
  padding: 72px 0 96px;
  font-family: "Fraunces", Georgia, serif;
}
.admin-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}
.admin-head h1 {
  margin: 4px 0 0;
  font-weight: 400;
  font-size: 2rem;
}
.admin-eyebrow {
  margin: 0;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}
.admin-link, .admin-text-button {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.78rem;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.admin-link:hover, .admin-text-button:hover {
  color: var(--fg);
}
.admin-card {
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 14px;
  padding: 28px;
  backdrop-filter: blur(6px);
}
.admin-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.admin-card h2 {
  margin: 0 0 8px;
  font-weight: 400;
  font-size: 1.3rem;
}
.admin-muted {
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 1.55;
}
.admin-muted code, .admin-card code {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.82em;
  color: var(--accent);
}
.admin-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 20px;
}
.admin-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.admin-field span {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.admin-field input {
  font-family: "IBM Plex Mono", monospace;
  font-size: 1rem;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--fg);
}
.admin-field input:focus {
  outline: none;
  border-color: var(--accent);
}
.admin-button {
  align-self: flex-start;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  padding: 12px 22px;
  border-radius: 10px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--bg);
  cursor: pointer;
  transition: opacity 0.2s ease;
}
.admin-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.admin-error {
  color: #ff8c7a;
  font-size: 0.9rem;
  margin: 0;
}
.admin-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 24px;
  margin: 20px 0 0;
}
.admin-meta div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.admin-meta dt {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.admin-meta dd {
  margin: 0;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.92rem;
  word-break: break-all;
}
.admin-result {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
}
.admin-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.admin-badge {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
}
.admin-badge.ok { color: var(--accent); border-color: var(--accent); }
.admin-badge.warn { color: var(--brass); border-color: var(--brass); }
.admin-badge.pending { color: var(--muted); }
`;
