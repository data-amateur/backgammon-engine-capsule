const DEVELOPMENT_PARENT_ORIGIN = "http://localhost:3000";

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]" ||
  hostname === "::1";

function parseOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))
  ) {
    throw new Error(`Invalid allowed parent origin: ${value}`);
  }
  return url.origin;
}

export function getAllowedParentOrigins(
  configured = import.meta.env.VITE_ALLOWED_PARENT_ORIGINS,
): ReadonlySet<string> {
  const source =
    configured ??
    (import.meta.env.PROD ? undefined : DEVELOPMENT_PARENT_ORIGIN);
  if (source === undefined) {
    throw new Error("VITE_ALLOWED_PARENT_ORIGINS is required in production");
  }
  const values = source
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0 || values.includes("*")) {
    throw new Error("At least one exact parent origin must be configured");
  }
  return new Set(values.map(parseOrigin));
}
