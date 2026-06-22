import type { RouterFetchOptions } from "@selat-ai/router-client";

export type DemoEndpoint = {
  id: string;
  step: string;
  name: string;
  rail: "mpp" | "x402";
  source: "Agentic Market" | "MPP";
  method: "GET" | "POST";
  url: string;
  description: string;
  outcome: string;
  price: string;
  headers?: Record<string, string>;
  body?: string;
};

export const demoEndpoints: DemoEndpoint[] = [
  {
    id: "catalyst-search",
    step: "01",
    name: "Find ETH catalysts",
    rail: "x402",
    source: "Agentic Market",
    method: "POST",
    url: "https://api.exa.ai/search",
    description: "Search the current web for ETH-specific catalysts, risks, and institutional flows.",
    outcome: "A ranked source list for the analyst brief.",
    price: "0.007-0.015 USDC",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(
      {
        query: "ETH market catalysts ETF flows restaking risk institutional demand latest",
        numResults: 5,
        type: "auto"
      },
      null,
      2
    )
  },
  {
    id: "quote-snapshot",
    step: "02",
    name: "Price the asset",
    rail: "x402",
    source: "Agentic Market",
    method: "GET",
    url: "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?symbol=ETH",
    description: "Pull the latest ETH market quote so the brief has a current price anchor.",
    outcome: "Current quote, market cap, and recent price movement.",
    price: "0.01 USDC"
  },
  {
    id: "smart-money-flow",
    step: "03",
    name: "Check smart-money flow",
    rail: "mpp",
    source: "MPP",
    method: "POST",
    url: "https://api.nansen.ai/api/v1/smart-money/netflow",
    description: "Inspect the top Ethereum tokens by 24-hour smart-money netflow.",
    outcome: "A ranked flow leaderboard for the final risk posture.",
    price: "0.05 USDC",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(
      {
        chains: ["ethereum"],
        filters: {
          include_native_tokens: true,
          include_smart_money_labels: ["Fund", "Smart Trader"],
          include_stablecoins: false
        },
        pagination: {
          page: 1,
          per_page: 10
        },
        order_by: [
          {
            field: "net_flow_24h_usd",
            direction: "DESC"
          }
        ]
      },
      null,
      2
    )
  },
  {
    id: "send-brief",
    step: "04",
    name: "Send the brief",
    rail: "mpp",
    source: "MPP",
    method: "POST",
    url: "https://stableemail.dev/api/send",
    description: "Deliver the analyst memo to a team inbox without a standing email API account.",
    outcome: "A paid delivery step for the completed market brief.",
    price: "0.02 USDC",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(
      {
        to: "analyst@example.com",
        subject: "ETH market brief",
        text: "SELAT routed the research, quote, and smart-money flow checks. Replace this with the generated brief."
      },
      null,
      2
    )
  }
];

export function getDemoEndpoint(endpointId: string) {
  return demoEndpoints.find((endpoint) => endpoint.id === endpointId);
}

export function toRouterFetchOptions(endpoint: DemoEndpoint): RouterFetchOptions {
  return {
    method: endpoint.method,
    headers: endpoint.headers,
    body: endpoint.body,
    preferProtocol: endpoint.rail
  };
}
