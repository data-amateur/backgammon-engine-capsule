import { defineConfig, loadEnv, type Plugin } from "vite";
import { isLoopbackHostname } from "./src/shared/webUrl";

const DEV_PARENT_ORIGIN = "http://localhost:3000";
const DEV_CAPSULE_ORIGIN = "http://localhost:4174";

function exactOrigin(value: string, variableName: string): string {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))
  ) {
    throw new Error(
      `${variableName} must contain exact HTTPS origins (HTTP is loopback-only)`,
    );
  }
  return url.origin;
}

function exactOrigins(value: string, variableName: string): string[] {
  const origins = value
    .split(",")
    .filter((origin) => origin.trim().length > 0)
    .map((origin) => exactOrigin(origin, variableName))
    .filter((origin, index, origins) => origins.indexOf(origin) === index);
  if (origins.length === 0 || value.split(",").some((origin) => !origin.trim())) {
    throw new Error(`${variableName} must contain exact origins`);
  }
  return origins;
}

function createSecurityHeaders(
  parentOrigins: readonly string[],
  capsuleOrigin: string,
): Record<string, string> {
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'self' ${capsuleOrigin}`,
    `connect-src 'self' ${capsuleOrigin}`,
    "worker-src blob:",
    `style-src 'self' ${capsuleOrigin}`,
    "img-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${parentOrigins.join(" ")}`,
  ].join("; ");

  return {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": contentSecurityPolicy,
  };
}

function emitStaticHostHeaders(
  headers: Readonly<Record<string, string>>,
): Plugin {
  return {
    name: "emit-capsule-security-headers",
    generateBundle() {
      const formattedHeaders = Object.entries(headers)
        .map(([name, value]) => `  ${name}: ${value}`)
        .join("\n");
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          "/*",
          formattedHeaders,
          "  Cache-Control: no-cache",
          "",
          "/assets/*",
          formattedHeaders,
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
        ].join("\n"),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const production = mode === "production";
  const configuredParentOrigins =
    env.VITE_ALLOWED_PARENT_ORIGINS ??
    (production ? undefined : DEV_PARENT_ORIGIN);
  const configuredCapsuleOrigin =
    env.VITE_CAPSULE_PUBLIC_ORIGIN ??
    (production ? undefined : DEV_CAPSULE_ORIGIN);
  if (!configuredParentOrigins?.trim() || !configuredCapsuleOrigin?.trim()) {
    throw new Error(
      "Production builds require VITE_ALLOWED_PARENT_ORIGINS and VITE_CAPSULE_PUBLIC_ORIGIN",
    );
  }
  const parentOrigins = exactOrigins(
    configuredParentOrigins,
    "VITE_ALLOWED_PARENT_ORIGINS",
  );
  const capsuleOrigin = exactOrigin(
    configuredCapsuleOrigin,
    "VITE_CAPSULE_PUBLIC_ORIGIN",
  );
  const headers = createSecurityHeaders(parentOrigins, capsuleOrigin);

  return {
    plugins: [emitStaticHostHeaders(headers)],
    server: {
      host: "127.0.0.1",
      port: 4174,
      strictPort: true,
      hmr: false,
      headers,
    },
    preview: {
      host: "127.0.0.1",
      port: 4174,
      strictPort: true,
      headers,
    },
    worker: {
      format: "es",
    },
    build: {
      target: "es2022",
      modulePreload: { polyfill: false },
      sourcemap: true,
      reportCompressedSize: true,
    },
  };
});
