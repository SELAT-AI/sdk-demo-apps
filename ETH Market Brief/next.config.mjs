import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCLE_AGENT_WALLET_NEXT_TRACE_INCLUDES } from "@selat-ai/router-client";

const requireFromConfig = createRequire(import.meta.url);
const configDir = path.dirname(fileURLToPath(import.meta.url));

function toTraceGlob(packageJsonPath) {
  const packageRoot = path.dirname(packageJsonPath);
  const relativeRoot = path.relative(configDir, packageRoot).split(path.sep).join("/");

  return relativeRoot.startsWith(".") ? relativeRoot + "/**/*" : "./" + relativeRoot + "/**/*";
}

function collectPackageDependencyTraceIncludesFromPackageJson(packageJsonPath, seen) {
  if (seen.has(packageJsonPath)) {
    return [];
  }

  seen.add(packageJsonPath);

  const packageRequire = createRequire(packageJsonPath);
  const packageJson = packageRequire(packageJsonPath);
  const dependencies = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {})
  });

  return [
    toTraceGlob(packageJsonPath),
    ...dependencies.flatMap((dependencyName) => {
      try {
        return collectPackageDependencyTraceIncludesFromPackageJson(
          packageRequire.resolve(dependencyName + "/package.json"),
          seen
        );
      } catch {
        return [];
      }
    })
  ];
}

function collectPackageDependencyTraceIncludes(packageName) {
  try {
    return collectPackageDependencyTraceIncludesFromPackageJson(
      requireFromConfig.resolve(packageName + "/package.json"),
      new Set()
    );
  } catch {
    return [];
  }
}

const circleAgentWalletTraceIncludes = Array.from(new Set([
  ...CIRCLE_AGENT_WALLET_NEXT_TRACE_INCLUDES,
  ...collectPackageDependencyTraceIncludes("@circle-fin/cli"),
  "./node_modules/ansi-regex/**/*",
  "./node_modules/@colors/colors/**/*"
]));

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
