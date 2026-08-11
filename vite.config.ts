import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { isLoopbackHostname } from "./src/shared/webUrl";

const DEV_PARENT_ORIGIN = "http://localhost:3000";
const DEV_CAPSULE_ORIGIN = "http://localhost:4174";
const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";
const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const generatedPublicRoot = path.join(repositoryRoot, "build/browser-public");
const browserManifestPath = path.join(
  repositoryRoot,
  "build/browser-assets-manifest.json",
);

interface BrowserAssetManifest {
  readonly schemaVersion: number;
  readonly mode: string;
  readonly engine: string;
  readonly publicBase: string;
  readonly capsuleOrigin: string;
  readonly buildId: string;
  readonly sourceUrl: string;
  readonly licenseUrl: string;
  readonly sourceBundle: {
    readonly publicBase: string;
    readonly path: string;
    readonly url: string;
    readonly size: number;
    readonly sha256: string;
  };
  readonly files: readonly {
    readonly path: string;
  }[];
}

function readBrowserManifest(mode: string): BrowserAssetManifest {
  let manifest: BrowserAssetManifest;
  try {
    manifest = JSON.parse(
      readFileSync(browserManifestPath, "utf8"),
    ) as BrowserAssetManifest;
  } catch (error) {
    throw new Error(
      "Generated GNUbg browser assets are missing; run the staged real-engine build first",
      { cause: error },
    );
  }
  if (
    manifest.schemaVersion !== 2 ||
    manifest.mode !== mode ||
    manifest.engine !== "gnubg" ||
    !/^\/engines\/sha256-[0-9a-f]{64}\/$/u.test(manifest.publicBase) ||
    !manifest.buildId ||
    !manifest.sourceUrl ||
    !manifest.licenseUrl ||
    !/^\/sources\/sha256-[0-9a-f]{64}\/$/u.test(
      manifest.sourceBundle?.publicBase,
    ) ||
    manifest.sourceBundle.url !== manifest.sourceUrl ||
    !manifest.sourceBundle.path.startsWith(
      manifest.sourceBundle.publicBase.slice(1),
    ) ||
    !Number.isSafeInteger(manifest.sourceBundle.size) ||
    manifest.sourceBundle.size <= 0 ||
    !/^[0-9a-f]{64}$/u.test(manifest.sourceBundle.sha256) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every(
      (file) =>
        typeof file === "object" &&
        file !== null &&
        typeof file.path === "string" &&
        file.path.length > 0,
    )
  ) {
    throw new Error("Generated GNUbg browser asset manifest is invalid");
  }
  return manifest;
}

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
    .filter((origin, index, allOrigins) => allOrigins.indexOf(origin) === index);
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
    `script-src 'self' 'wasm-unsafe-eval' ${capsuleOrigin}`,
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
  immutableAssetPatterns: readonly string[],
  sourceArchivePath: string,
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
          ...immutableAssetPatterns.flatMap((assetPattern) => [
            assetPattern,
            formattedHeaders,
            "  Cache-Control: public, max-age=31536000, immutable",
            "",
          ]),
          sourceArchivePath,
          formattedHeaders,
          "  Content-Type: application/gzip",
          "  Content-Encoding: identity",
          "  Content-Disposition: attachment; filename=backgammon-engine-capsule-source.tar.gz",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
        ].join("\n"),
      });
    },
  };
}

function applyPreviewCachePolicy(
  immutableAssetPaths: ReadonlySet<string>,
  sourceArchivePath: string,
): Plugin {
  return {
    name: "apply-capsule-preview-cache-policy",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const rawUrl = request.url;
        if (!rawUrl?.startsWith("/") || rawUrl.startsWith("//")) {
          next();
          return;
        }
        let pathname: string;
        try {
          pathname = decodeURI(new URL(
            rawUrl,
            "http://preview.invalid",
          ).pathname);
        } catch {
          next();
          return;
        }
        if (immutableAssetPaths.has(pathname)) {
          response.setHeader("Cache-Control", IMMUTABLE_CACHE_CONTROL);
        }
        if (pathname === sourceArchivePath) {
          response.setHeader("Content-Type", "application/gzip");
          response.setHeader("Content-Encoding", "identity");
          response.setHeader(
            "Content-Disposition",
            "attachment; filename=backgammon-engine-capsule-source.tar.gz",
          );
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const manifest = readBrowserManifest(mode);
  const env = {
    ...loadEnv(mode, repositoryRoot, "VITE_"),
    ...process.env,
  };
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
  if (capsuleOrigin !== manifest.capsuleOrigin) {
    throw new Error(
      "VITE_CAPSULE_PUBLIC_ORIGIN does not match the staged GNUbg assets",
    );
  }
  if (
    production &&
    (!env.VITE_BUILD_ID?.trim() ||
      !env.VITE_LICENSE_URL?.trim())
  ) {
    throw new Error(
      "Production builds require VITE_BUILD_ID and VITE_LICENSE_URL",
    );
  }

  const headers = createSecurityHeaders(parentOrigins, capsuleOrigin);
  const immutableContentPaths = new Set(
    manifest.files
      .map(({ path: publicPath }) => `/${publicPath}`)
      .filter((publicPath) => publicPath.startsWith(manifest.publicBase)),
  );
  if (immutableContentPaths.size === 0) {
    throw new Error("Generated GNUbg browser manifest has no engine assets");
  }
  immutableContentPaths.add(`/${manifest.sourceBundle.path}`);
  return {
    publicDir: generatedPublicRoot,
    define: {
      "import.meta.env.VITE_GNUBG_ASSET_BASE": JSON.stringify(
        manifest.publicBase,
      ),
    },
    plugins: [
      emitStaticHostHeaders(headers, [
        `${manifest.publicBase}*`,
        `${manifest.sourceBundle.publicBase}*`,
      ], `/${manifest.sourceBundle.path}`),
      applyPreviewCachePolicy(
        immutableContentPaths,
        `/${manifest.sourceBundle.path}`,
      ),
    ],
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
