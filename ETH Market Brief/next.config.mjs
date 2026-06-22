/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  typedRoutes: true,
  outputFileTracingIncludes: {
    "/api/selat-demo": [
      "./node_modules/.bin/circle",
      "./node_modules/@circle-fin/cli/**/*"
    ],
    "/api/gateway-txns": [
      "./node_modules/.bin/circle",
      "./node_modules/@circle-fin/cli/**/*"
    ]
  }
};

export default nextConfig;
