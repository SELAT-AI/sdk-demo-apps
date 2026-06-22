import { CIRCLE_AGENT_WALLET_NEXT_TRACE_INCLUDES } from "@selat-ai/router-client";

const circleAgentWalletTraceIncludes = [
  ...CIRCLE_AGENT_WALLET_NEXT_TRACE_INCLUDES,
  "./node_modules/@scure/**/*",
  "./node_modules/isows/**/*",
  "./node_modules/ox/**/*",
  "./node_modules/ws/**/*"
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  typedRoutes: true,
  outputFileTracingIncludes: {
    "/api/selat-demo": circleAgentWalletTraceIncludes,
    "/api/gateway-txns": circleAgentWalletTraceIncludes
  }
};

export default nextConfig;
