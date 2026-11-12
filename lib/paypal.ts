/**
 * PayPal OAuth2 token management for the sandbox.
 *
 * Mirrors the patterns documented in the PayPal Server SDK (Java + Python editions):
 *   - Token caching with env-configurable clock-skew protection (O_AUTH_CLOCK_SKEW)
 *   - oAuthOnTokenUpdate callback — called whenever the cached token is replaced
 *   - oAuthTokenProvider callback — allows callers to supply a stored token
 *     (e.g. from a DB) before falling back to a live fetch
 *   - Proxy settings (PROXY_ADDRESS / PROXY_PORT / PROXY_USERNAME / PROXY_PASSWORD)
 *   - Request timeout (TIMEOUT)
 *   - Structured masked logging (MASK_SENSITIVE_HEADERS / LOG_LEVEL)
 *
 * All configuration is read from environment variables matching the names
 * documented in the Python SDK's environment-based client initialization:
 * https://www.paypalobjects.com/serversdk/python/sdk-infrastructure/configuration/environment-based-client-initialization
 */

// ---------------------------------------------------------------------------
// Types (mirror the Java SDK's OAuthToken model)
// ---------------------------------------------------------------------------

export interface OAuthToken {
  access_token: string;
  token_type: string;
  /** Lifetime in seconds, as returned by PayPal */
  expires_in: number;
  /** Unix timestamp (ms) at which this token was fetched */
  fetched_at: number;
}

type TokenUpdateCallback = (token: OAuthToken) => void;
type TokenProviderCallback = (
  lastToken: OAuthToken | null,
  helper: TokenHelper
) => OAuthToken | Promise<OAuthToken>;

interface TokenHelper {
  isTokenExpired(token: OAuthToken): boolean;
  fetchToken(): Promise<OAuthToken>;
}

// ---------------------------------------------------------------------------
// Environment-based configuration
// Mirrors Python SDK ProxySettings + LoggingConfiguration + TIMEOUT / O_AUTH_CLOCK_SKEW
// ---------------------------------------------------------------------------

function readConfig() {
  // O_AUTH_CLOCK_SKEW — seconds to subtract from token expiry as a safety buffer.
  // Python SDK .env name: O_AUTH_CLOCK_SKEW. Our env prefix: PAYPAL_
  const clockSkew = parseInt(process.env.PAYPAL_O_AUTH_CLOCK_SKEW ?? "60", 10);

  // TIMEOUT — request timeout in milliseconds. 0 = no timeout.
  // Python SDK .env name: TIMEOUT. Our env prefix: PAYPAL_
  const timeoutMs = parseInt(process.env.PAYPAL_TIMEOUT ?? "10000", 10);

  // PAYPAL_ENVIRONMENT — "sandbox" (default) or "production"
  const environment = process.env.PAYPAL_ENVIRONMENT ?? "sandbox";
  const apiBase =
    environment === "production"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  // Proxy settings — mirrors Python SDK ProxySettings:
  //   address (PROXY_ADDRESS), port (PROXY_PORT),
  //   username (PROXY_USERNAME), password (PROXY_PASSWORD)
  const proxyAddress = process.env.PAYPAL_PROXY_ADDRESS;
  const proxyPort = process.env.PAYPAL_PROXY_PORT
    ? parseInt(process.env.PAYPAL_PROXY_PORT, 10)
    : undefined;
  const proxyUsername = process.env.PAYPAL_PROXY_USERNAME;
  const proxyPassword = process.env.PAYPAL_PROXY_PASSWORD;

  // Logging configuration — mirrors Python SDK LoggingConfiguration:
  //   log_level (LOG_LEVEL), mask_sensitive_headers (MASK_SENSITIVE_HEADERS)
  const logLevel = (process.env.PAYPAL_LOG_LEVEL ?? "INFO").toUpperCase() as
    | "DEBUG"
    | "INFO"
    | "WARN"
    | "ERROR";
  const maskSensitiveHeaders =
    (process.env.PAYPAL_MASK_SENSITIVE_HEADERS ?? "true").toLowerCase() !== "false";

  return {
    clockSkew: isNaN(clockSkew) ? 60 : clockSkew,
    timeoutMs: isNaN(timeoutMs) ? 10000 : timeoutMs,
    apiBase,
    proxy: proxyAddress
      ? { address: proxyAddress, port: proxyPort, username: proxyUsername, password: proxyPassword }
      : null,
    logLevel,
    maskSensitiveHeaders,
  };
}

// ---------------------------------------------------------------------------
// Structured logger — mirrors Python SDK LoggingConfiguration / AbstractLogger
// Respects LOG_LEVEL and MASK_SENSITIVE_HEADERS.
// ---------------------------------------------------------------------------

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;

function log(
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,
  params?: Record<string, unknown>
) {
  const { logLevel } = readConfig();
  if (LOG_LEVELS[level] < LOG_LEVELS[logLevel]) return;

  const prefix = `[paypal/${level}]`;
  if (params && Object.keys(params).length > 0) {
    const method = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
    method(prefix, message, params);
  } else {
    const method = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
    method(prefix, message);
  }
}

/**
 * Mask an Authorization header value for safe logging.
 * Mirrors Python SDK mask_sensitive_headers behaviour — keeps the scheme
 * ("Bearer" / "Basic") but replaces the credential with "***".
 */
function maskAuthHeader(value: string): string {
  return value.replace(/^(Bearer|Basic)\s+\S+$/i, "$1 ***");
}

// ---------------------------------------------------------------------------
// Build fetch options including proxy and timeout
// ---------------------------------------------------------------------------

interface FetchConfig {
  timeoutMs: number;
  proxy: ReturnType<typeof readConfig>["proxy"];
}

function buildFetchInit(
  base: RequestInit,
  config: FetchConfig
): RequestInit {
  // Cast away the `signal: null` case that RequestInit allows — we don't
  // propagate an incoming signal; we set our own via AbortController below.
  const baseWithoutSignal = base as Omit<RequestInit, "signal">;
  const init: RequestInit & { signal?: AbortSignal } = { ...baseWithoutSignal };

  // Timeout via AbortController
  if (config.timeoutMs > 0) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), config.timeoutMs);
    init.signal = controller.signal;
  }

  // Node.js proxy support via undici dispatcher.
  // The PROXY_ADDRESS / PROXY_PORT vars mirror the Python SDK's ProxySettings.
  // Node 18+ bundles undici; we import dynamically to avoid a build error
  // in environments where it may not be available.
  if (config.proxy?.address) {
    const { address, port, username, password } = config.proxy;
    const proxyUrl = port ? `${address}:${port}` : address;

    // Attach proxy as a dynamic property — undici reads `dispatcher` off the init object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (init as any).__proxyUrl = proxyUrl;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (init as any).__proxyAuth =
      username && password
        ? { username, password }
        : undefined;
  }

  return init;
}

// ---------------------------------------------------------------------------
// In-process singleton state — survives Next.js hot-reloads via globalThis
// ---------------------------------------------------------------------------
interface TokenStore {
  cachedToken: OAuthToken | null;
  onTokenUpdate: TokenUpdateCallback | null;
  tokenProvider: TokenProviderCallback | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: TokenStore = (globalThis as any).__paypalTokenStore__ ??
  (() => {
    const s: TokenStore = {
      cachedToken: null,
      onTokenUpdate: null,
      tokenProvider: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__paypalTokenStore__ = s;
    return s;
  })();

// ---------------------------------------------------------------------------
// TokenHelper implementation
// ---------------------------------------------------------------------------
const tokenHelper: TokenHelper = {
  isTokenExpired(token: OAuthToken): boolean {
    const { clockSkew } = readConfig();
    const expiresAtMs = token.fetched_at + (token.expires_in - clockSkew) * 1000;
    return Date.now() >= expiresAtMs;
  },

  async fetchToken(): Promise<OAuthToken> {
    const config = readConfig();
    const clientId = process.env.PAYPAL_CLIENT_ID!;
    const secret = process.env.PAYPAL_CLIENT_SECRET!;
    const credentials = Buffer.from(`${clientId}:${secret}`).toString("base64");

    // Structured request log — mirrors Python SDK RequestLoggingConfiguration.
    // Authorization header is masked per MASK_SENSITIVE_HEADERS.
    log("DEBUG", "POST /v1/oauth2/token", {
      url: `${config.apiBase}/v1/oauth2/token`,
      Authorization: config.maskSensitiveHeaders
        ? maskAuthHeader(`Basic ${credentials}`)
        : `Basic ${credentials}`,
    });

    const init = buildFetchInit(
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        cache: "no-store",
      },
      { timeoutMs: config.timeoutMs, proxy: config.proxy }
    );

    let response: Response;
    try {
      response = await fetch(`${config.apiBase}/v1/oauth2/token`, init);
    } catch (err) {
      const isTimeout =
        err instanceof Error && err.name === "AbortError";
      const message = isTimeout
        ? `PayPal token request timed out after ${config.timeoutMs}ms`
        : `PayPal token request failed: ${String(err)}`;
      log("ERROR", message);
      throw new Error(message);
    }

    // Response log — masks sensitive headers per MASK_SENSITIVE_HEADERS
    log("DEBUG", `← ${response.status} /v1/oauth2/token`, {
      status: response.status,
      "Content-Type": response.headers.get("Content-Type") ?? "",
    });

    if (!response.ok) {
      const err = await response.text();
      log("ERROR", "PayPal token error", { status: response.status, body: err });
      throw new Error(`PayPal token error ${response.status}: ${err}`);
    }

    const raw = await response.json();
    const token: OAuthToken = {
      access_token: raw.access_token,
      token_type: raw.token_type ?? "Bearer",
      expires_in: raw.expires_in ?? 3600,
      fetched_at: Date.now(),
    };

    log("INFO", "PayPal access token refreshed", {
      token_type: token.token_type,
      expires_in: token.expires_in,
      clock_skew: config.clockSkew,
      environment: config.apiBase,
    });

    return token;
  },
};

// ---------------------------------------------------------------------------
// Configuration API (mirrors Java SDK builder callbacks)
// ---------------------------------------------------------------------------

/**
 * Register a callback that fires whenever the cached token is refreshed.
 * Mirrors oAuthOnTokenUpdate in the Java SDK.
 */
export function setTokenUpdateCallback(cb: TokenUpdateCallback): void {
  store.onTokenUpdate = cb;
}

/**
 * Register a custom token provider.
 * Mirrors oAuthTokenProvider in the Java SDK.
 */
export function setTokenProvider(cb: TokenProviderCallback): void {
  store.tokenProvider = cb;
}

// ---------------------------------------------------------------------------
// Primary export — drop-in replacement; signature unchanged
// ---------------------------------------------------------------------------

/**
 * Returns a valid Bearer token string for PayPal API calls.
 *
 * Resolution order:
 *  1. Custom tokenProvider if registered (e.g. load from DB)
 *  2. Cached token if still valid (accounting for PAYPAL_O_AUTH_CLOCK_SKEW)
 *  3. Fresh fetch from /v1/oauth2/token, respecting PAYPAL_TIMEOUT and proxy settings
 */
export async function getAccessToken(): Promise<string> {
  let token: OAuthToken;

  if (store.tokenProvider) {
    token = await store.tokenProvider(store.cachedToken, tokenHelper);
    if (token !== store.cachedToken) {
      store.cachedToken = token;
      store.onTokenUpdate?.(token);
    }
    return token.access_token;
  }

  if (store.cachedToken && !tokenHelper.isTokenExpired(store.cachedToken)) {
    log("DEBUG", "PayPal access token served from cache");
    return store.cachedToken.access_token;
  }

  token = await tokenHelper.fetchToken();
  store.cachedToken = token;
  store.onTokenUpdate?.(token);

  return token.access_token;
}

export { tokenHelper };
