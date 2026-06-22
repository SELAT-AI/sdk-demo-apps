"use client";

import { useMemo, useState } from "react";
import type { DemoEndpoint } from "@/lib/demo-catalogue";
import type { OffchainPaymentPayload } from "@/lib/offchain-payload-store";

type DemoConsoleProps = {
  endpoints: DemoEndpoint[];
};

type DemoResult = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: string;
  error?: string;
  setup?: string;
  offchainPayloads?: OffchainPaymentPayload[];
};

type MissionEntry = {
  endpointId: string;
  name: string;
  status: string;
  summary: string;
  txns: TxnRecord[];
};

type TxnField = {
  label: string;
  value: string;
};

type TxnRecord = {
  source: string;
  fields: TxnField[];
};

const FALLBACK_BRIEF = `ETH Market Brief

Positioning view: neutral until the research, quote, and smart-money checks agree on direction.

What the analyst is checking:
- Current catalysts and risks for ETH over the next 24 hours
- Spot quote context before any treasury action
- Smart-money accumulation or distribution signal

Suggested next move: run the brief steps, review the mission log, then send the finished note.`;

const TXN_KEY_PATTERN = /(tx|txn|transaction|receipt|settlement|quote|block).*?(id|hash|number)?|hash|explorer/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatTxnValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function collectTxnFields(value: unknown, prefix = "", fields: TxnField[] = []) {
  if (fields.length >= 12) {
    return fields;
  }

  if (Array.isArray(value)) {
    value.slice(0, 6).forEach((item, index) => collectTxnFields(item, `${prefix}[${index}]`, fields));
    return fields;
  }

  if (!isRecord(value)) {
    return fields;
  }

  Object.entries(value).forEach(([key, fieldValue]) => {
    if (fields.length >= 12) {
      return;
    }

    const label = prefix ? `${prefix}.${key}` : key;

    if (TXN_KEY_PATTERN.test(key)) {
      fields.push({
        label,
        value: formatTxnValue(fieldValue)
      });
      return;
    }

    if (isRecord(fieldValue) || Array.isArray(fieldValue)) {
      collectTxnFields(fieldValue, label, fields);
    }
  });

  return fields;
}

function extractTxns(result: DemoResult): TxnRecord[] {
  const txns: TxnRecord[] = [];
  const headerFields = collectTxnFields(result.headers);
  const bodyFields = collectTxnFields(result.body);

  if (headerFields.length > 0) {
    txns.push({ source: "Payment headers", fields: headerFields });
  }

  if (bodyFields.length > 0) {
    txns.push({ source: "Response body", fields: bodyFields });
  }

  return txns;
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  });
}

function mergeOffchainPayloads(
  incoming: OffchainPaymentPayload[] | undefined,
  current: OffchainPaymentPayload[]
) {
  if (!incoming?.length) {
    return current;
  }

  const seen = new Set<string>();

  return [...incoming, ...current].filter((payload) => {
    if (seen.has(payload.id)) {
      return false;
    }

    seen.add(payload.id);

    return true;
  });
}

function offchainSummaryFields(payload: OffchainPaymentPayload): TxnField[] {
  return [
    { label: "Timestamp", value: formatTimestamp(payload.capturedAt) },
    { label: "Quote id", value: payload.quoteId ?? "Not returned" },
    { label: "Target endpoint", value: payload.targetUrl },
    { label: "Payment signature", value: payload.paymentSignature },
    { label: "Signature digest", value: payload.paymentSignatureDigest ?? "Not recorded" }
  ];
}

function resultSummary(endpoint: DemoEndpoint, result: DemoResult) {
  if (result.error) {
    return result.error;
  }

  if (result.setup) {
    return result.setup;
  }

  const body =
    typeof result.body === "string"
      ? result.body
      : result.body
        ? JSON.stringify(result.body)
        : endpoint.outcome;

  return body.length > 180 ? `${body.slice(0, 180)}...` : body;
}

function buildBrief(entries: MissionEntry[]) {
  if (entries.length === 0) {
    return FALLBACK_BRIEF;
  }

  const evidence = entries
    .map((entry, index) => `${index + 1}. ${entry.name}: ${entry.status}. ${entry.summary}`)
    .join("\n");

  return `ETH Market Brief

Audience: treasury analyst
Time horizon: next 24 hours

Evidence gathered:
${evidence}

Readout:
The agent has assembled paid-market evidence through SELAT. Review the successful checks above before adjusting ETH exposure. Failed checks should be rerun or replaced before the memo is treated as complete.`;
}

export function DemoConsole({ endpoints }: DemoConsoleProps) {
  const deliveryEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === "send-brief"),
    [endpoints]
  );
  const workflowEndpoints = useMemo(
    () => endpoints.filter((endpoint) => endpoint.id !== "send-brief"),
    [endpoints]
  );
  const [selectedEndpointId, setSelectedEndpointId] = useState(workflowEndpoints[0]?.id ?? endpoints[0]?.id ?? "");
  const selectedEndpoint = useMemo(
    () => workflowEndpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? workflowEndpoints[0],
    [workflowEndpoints, selectedEndpointId]
  );
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [missionEntries, setMissionEntries] = useState<MissionEntry[]>([]);
  const [txnRecords, setTxnRecords] = useState<TxnRecord[]>([]);
  const [offchainPayloads, setOffchainPayloads] = useState<OffchainPaymentPayload[]>([]);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [deliveryResult, setDeliveryResult] = useState<DemoResult | null>(null);
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const briefText = useMemo(() => buildBrief(missionEntries), [missionEntries]);

  function selectEndpoint(endpointId: string) {
    const nextEndpoint = endpoints.find((endpoint) => endpoint.id === endpointId);

    if (!nextEndpoint) {
      return;
    }

    setSelectedEndpointId(nextEndpoint.id);
    setResult(null);
  }

  async function sendRequest() {
    if (!selectedEndpoint) {
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/selat-demo", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          endpointId: selectedEndpointId
        })
      });

      const json = (await response.json()) as DemoResult;
      const txns = extractTxns(json);
      setResult(json);
      setTxnRecords(txns);
      setOffchainPayloads((current) => mergeOffchainPayloads(json.offchainPayloads, current));
      setMissionEntries((currentEntries) => {
        const nextEntry = {
          endpointId: selectedEndpoint.id,
          name: selectedEndpoint.name,
          status: json.ok ? "complete" : "needs attention",
          summary: resultSummary(selectedEndpoint, json),
          txns
        };
        const remainingEntries = currentEntries.filter((entry) => entry.endpointId !== selectedEndpoint.id);

        return [...remainingEntries, nextEntry].sort((left, right) => {
          const leftIndex = workflowEndpoints.findIndex((endpoint) => endpoint.id === left.endpointId);
          const rightIndex = workflowEndpoints.findIndex((endpoint) => endpoint.id === right.endpointId);

          return leftIndex - rightIndex;
        });
      });
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : "Request failed before reaching the demo route."
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function sendBrief() {
    if (!deliveryEndpoint) {
      setDeliveryMessage("Delivery is not configured for this demo.");
      return;
    }

    if (!recipientEmail.includes("@")) {
      setDeliveryMessage("Enter an email address before sending the brief.");
      return;
    }

    setIsLoading(true);
    setDeliveryResult(null);
    setDeliveryMessage("");

    try {
      const response = await fetch("/api/selat-demo", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          endpointId: deliveryEndpoint.id,
          body: JSON.stringify(
            {
              to: recipientEmail,
              subject: "ETH market brief",
              text: briefText
            },
            null,
            2
          )
        })
      });

      const json = (await response.json()) as DemoResult;
      const txns = extractTxns(json);
      setDeliveryResult(json);
      setTxnRecords(txns);
      setOffchainPayloads((current) => mergeOffchainPayloads(json.offchainPayloads, current));
      setDeliveryMessage(json.ok ? "Brief sent." : json.error ?? "Delivery needs attention.");
    } catch (error) {
      setDeliveryMessage(error instanceof Error ? error.message : "Delivery failed before reaching the demo route.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="demo-console">
      <section className="demo-picker" aria-label="Market brief workflow">
        {workflowEndpoints.map((endpoint) => (
          <button
            className={endpoint.id === selectedEndpointId ? "demo-endpoint is-active" : "demo-endpoint"}
            key={endpoint.id}
            onClick={() => selectEndpoint(endpoint.id)}
            type="button"
          >
            <span>Step {endpoint.step}</span>
            <strong>{endpoint.name}</strong>
            <small>{endpoint.description}</small>
            <em>{endpoint.price}</em>
          </button>
        ))}
      </section>

      <section className="demo-workbench consumer-workbench" aria-label="Market brief step">
        <div className="brief-panel">
          <span>Selected action</span>
          <h2>{selectedEndpoint?.name}</h2>
          <p>{selectedEndpoint?.outcome}</p>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{selectedEndpoint?.source}</dd>
            </div>
            <div>
              <dt>Estimated cost</dt>
              <dd>{selectedEndpoint?.price}</dd>
            </div>
          </dl>
        </div>

        <div className="brief-briefing">
          <span>Brief settings</span>
          <div className="brief-setting-grid">
            <div>
              <strong>Asset</strong>
              <small>ETH</small>
            </div>
            <div>
              <strong>Chain</strong>
              <small>Ethereum Mainnet</small>
            </div>
            <div>
              <strong>Audience</strong>
              <small>Treasury analyst</small>
            </div>
            <div>
              <strong>Time horizon</strong>
              <small>Next 24 hours</small>
            </div>
          </div>
          <button className="button" disabled={isLoading} onClick={sendRequest} type="button">
            {isLoading ? "Working..." : "Run This Step"}
          </button>
        </div>
      </section>

      <section className="delivery-panel" aria-label="Send market brief">
        <div className="brief-preview">
          <span>Brief preview</span>
          <pre>{briefText}</pre>
        </div>
        <div className="send-brief-card">
          <span>Send me this brief</span>
          <h2>Deliver the memo</h2>
          <p>
            Email the current brief after the agent has gathered enough evidence. This uses the paid delivery step only
            when you press send.
          </p>
          <label className="email-field">
            <span>Email</span>
            <input
              onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={recipientEmail}
            />
          </label>
          <button className="button" disabled={isLoading} onClick={sendBrief} type="button">
            {isLoading ? "Sending..." : "Send Me This Brief"}
          </button>
          <small>{deliveryMessage || `${deliveryEndpoint?.price ?? "Paid"} delivery via SELAT.`}</small>
        </div>
      </section>

      <section className="txn-panel" aria-label="Payment transactions">
        <div>
          <span>Txns</span>
          {txnRecords.length > 0 ? (
            <div className="txn-records">
              {txnRecords.map((record) => (
                <section key={record.source}>
                  <strong>{record.source}</strong>
                  <dl>
                    {record.fields.map((field) => (
                      <div key={`${record.source}-${field.label}`}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ) : (
            <p>Run a paid step to see quote IDs, transaction hashes, settlement IDs, or receipt fields returned by SELAT.</p>
          )}
        </div>
      </section>

      <section className="offchain-panel" aria-label="Offchain Gateway payloads">
        <div className="offchain-panel-header">
          <span>Offchain Gateway payloads</span>
          <small>{offchainPayloads.length} captured</small>
        </div>
        {offchainPayloads.length > 0 ? (
          <div className="offchain-records">
            {offchainPayloads.map((payload) => (
              <section key={payload.id}>
                <div className="offchain-record-title">
                  <strong>{payload.endpointName ?? "Paid request"}</strong>
                  <small>{payload.preferProtocol?.toUpperCase() ?? "SELAT"}</small>
                </div>
                <dl>
                  {offchainSummaryFields(payload).map((field) => (
                    <div key={`${payload.id}-${field.label}`}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
                <pre>{JSON.stringify(payload.decodedPayload, null, 2)}</pre>
              </section>
            ))}
          </div>
        ) : (
          <p>
            Run a paid step to capture the generated PAYMENT-SIGNATURE, decoded payload, quote id, target endpoint,
            and timestamp on the server.
          </p>
        )}
      </section>

      <section className="demo-output mission-log" aria-label="Mission log">
        <div>
          <span>Mission log</span>
          {missionEntries.length > 0 ? (
            <ol className="mission-entries">
              {missionEntries.map((entry) => (
                <li key={entry.endpointId}>
                  <strong>{entry.name}</strong>
                  <small>{entry.status}</small>
                  <p>{entry.summary}</p>
                  {entry.txns.length > 0 ? <em>{entry.txns.length} txn source shown above</em> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p>Choose a step and run it to add evidence to the ETH market brief.</p>
          )}
          {result?.error || deliveryResult?.error ? (
            <p className="mission-alert">{result?.error ?? deliveryResult?.error}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
