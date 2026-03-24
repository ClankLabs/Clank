/**
 * OpenAI OAuth — Authorization Code + PKCE flow.
 *
 * This is the same flow ChatGPT uses. The user opens a browser, signs in
 * with their OpenAI account, and gets redirected back to a local callback
 * server. The access token lets Clank use Codex models via the user's
 * ChatGPT Plus/Pro subscription without separate API costs.
 */

import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { platform } from "node:os";

// OpenAI OAuth constants
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const SCOPES = "openid profile email offline_access";
const CALLBACK_PORT = 1455;

/** Token response from OpenAI */
export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/** Stored OAuth credential */
export interface OAuthCredential {
  type: "oauth";
  provider: "openai-codex";
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
  email: string;
  clientId: string;
}

/** Generate PKCE pair (verifier + challenge) */
export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Generate random state parameter for CSRF protection */
export function generateState(): string {
  return randomBytes(32).toString("hex");
}

/** Build the full authorization URL */
export function buildAuthorizationUrl(challenge: string, state: string): URL {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("originator", "pi");
  return url;
}

/**
 * Start a temporary HTTP server to catch the OAuth callback.
 * Returns the authorization code from the redirect.
 */
export function startCallbackServer(expectedState: string, timeoutMs = 60_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        if (returnedState !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>State mismatch — possible CSRF attack.</h2></body></html>");
          cleanup();
          reject(new Error("OAuth state mismatch — possible CSRF attack"));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>No authorization code received.</h2></body></html>");
          cleanup();
          reject(new Error("No authorization code in callback"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authenticated! You can close this tab.</h2></body></html>");
        cleanup();
        resolve(code);
      }
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("OAuth callback timed out — no response within 60 seconds"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      server.close();
    }

    server.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${CALLBACK_PORT} is in use. Close whatever is using it and try again.`));
      } else {
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string, verifier: string): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return (await res.json()) as OAuthTokens;
}

/** Refresh an expired access token */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  return (await res.json()) as OAuthTokens;
}

/** Decode a JWT payload (no signature verification — token is from OpenAI) */
export function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString());
}

/** Extract account info from an access token JWT */
export function extractAccountInfo(accessToken: string): { accountId: string; email: string } {
  const claims = decodeJwt(accessToken);
  const authClaims = claims["https://api.openai.com/auth"] as Record<string, string> | undefined;
  return {
    accountId: authClaims?.chatgpt_account_id || "",
    email: (claims.email as string) || "",
  };
}

/** Check if running in a remote/headless environment */
export function isRemoteEnvironment(): boolean {
  return !!(
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY ||
    process.env.REMOTE_CONTAINERS ||
    process.env.CODESPACES ||
    (platform() === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
  );
}

/** Open a URL in the default browser */
export function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open"
    : platform() === "win32" ? "start"
    : "xdg-open";

  // Use exec to avoid blocking, ignore errors (browser may not be available)
  exec(`${cmd} "${url}"`, () => {});
}

/**
 * Run the complete OAuth flow.
 *
 * 1. Generate PKCE pair + state
 * 2. Start local callback server
 * 3. Open browser (or show URL for manual paste)
 * 4. Wait for callback with authorization code
 * 5. Exchange code for tokens
 * 6. Extract account info from JWT
 * 7. Return credential
 */
export async function runOAuthFlow(opts?: {
  onUrl?: (url: string) => void;
  onProgress?: (msg: string) => void;
}): Promise<OAuthCredential> {
  const { verifier, challenge } = generatePKCE();
  const state = generateState();
  const authUrl = buildAuthorizationUrl(challenge, state);

  opts?.onProgress?.("Starting OAuth flow...");

  // Start callback server first
  const codePromise = startCallbackServer(state);

  // Open browser or show URL
  if (isRemoteEnvironment()) {
    opts?.onProgress?.("Remote environment detected — paste this URL in your browser:");
    opts?.onUrl?.(authUrl.toString());
  } else {
    opts?.onProgress?.("Opening browser for OpenAI login...");
    openBrowser(authUrl.toString());
    opts?.onUrl?.(authUrl.toString());
  }

  // Wait for the authorization code
  const code = await codePromise;
  opts?.onProgress?.("Authorization code received, exchanging for tokens...");

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code, verifier);
  opts?.onProgress?.("Tokens received, extracting account info...");

  // Extract account info
  const { accountId, email } = extractAccountInfo(tokens.access_token);

  return {
    type: "oauth",
    provider: "openai-codex",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + tokens.expires_in * 1000,
    accountId,
    email,
    clientId: CLIENT_ID,
  };
}
