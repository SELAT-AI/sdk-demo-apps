import { CIRCLE_AGENT_WALLET_NEXT_TRACE_INCLUDES } from "@selat-ai/router-client";

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  typedRoutes: true,
  outputFileTracingIncludes: {
    "/api/selat-demo": CIRCLE_AGENT_WALLET_NEXT_TRACE_INCLUDES,
    "/api/gateway-txns": CIRCLE_AGENT_WALLET_NEXT_TRACE_INCLUDES
  }
};

export default nextConfig;
