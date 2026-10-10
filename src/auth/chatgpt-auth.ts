import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const issuer = "https://auth.openai.com";
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const resource = "https://api.openai.com/v1";
const requestedScopes =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const credentialsSchema = z.object({
  clientId: z.string().min(1),
  subject: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  expiresAt: z.number(),
  scopes: z.array(z.string())
});
export type ChatGPTCredentials = z.infer<typeof credentialsSchema>;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional()
});

export function authorizationUrl(
  hostId: string,
  redirectUri: string,
  state: string,
  nonce: string,
  verifier: string,
  previous?: ChatGPTCredentials
): URL {
  const url = new URL(`${issuer}/api/accounts/authorize`);
  const params: Record<string, string> = {
    client_id: previous?.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: requestedScopes,
    resource,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url")
  };
  if (previous) params.id_token_hint = previous.idToken;
  else params.agent_name_hint = "Survey Agent";
  url.search = new URLSearchParams(params).toString();
  return url;
}

export function validateCallback(
  url: URL,
  expectedState: string,
  previousClientId?: string
): { code: string; clientId: string } {
  if (
    url.pathname !== "/auth/callback" ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== expectedState
  )
    throw new Error("Invalid OAuth callback state.");
  if (url.searchParams.has("error")) throw new Error("ChatGPT authorization declined or failed.");
  const clientId = url.searchParams.get("client_id") ?? previousClientId;
  const code = url.searchParams.get("code");
  if (
    !clientId ||
    clientId === "dynamic_agent_client" ||
    !code ||
    (previousClientId && clientId !== previousClientId)
  )
    throw new Error("Invalid OAuth registration callback.");
  return { code, clientId };
}

export async function verifyIdentity(
  idToken: string,
  clientId: string,
  nonce: string
): Promise<string> {
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(idToken, keys, { issuer, audience: clientId });
  if (payload.nonce !== nonce || !payload.sub)
    throw new Error("Invalid ChatGPT identity nonce or subject.");
  return payload.sub;
}

async function atomicSave(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export class ChatGPTAuth {
  private readonly credentialPath: string;
  public constructor(
    private readonly directory: string,
    account = "default"
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(account)) throw new Error("Invalid ChatGPT account label.");
    this.credentialPath = join(directory, `chatgpt-${account}.json`);
  }
  public async credentials(): Promise<ChatGPTCredentials | undefined> {
    try {
      return credentialsSchema.parse(JSON.parse(await readFile(this.credentialPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("ChatGPT credential record is invalid; sign in again.");
    }
  }
  private async hostId(): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, "chatgpt-host.json");
    try {
      const saved = JSON.parse(await readFile(path, "utf8")) as { id: string };
      if (!/^urn:uuid:[0-9a-f-]{36}$/.test(saved.id)) throw new Error("Invalid ChatGPT host ID.");
      return saved.id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const id = `urn:uuid:${randomUUID()}`;
      await writeFile(path, JSON.stringify({ id }), { mode: 0o600, flag: "wx" });
      return id;
    }
  }
  public async signIn(openBrowser: (url: string) => Promise<void>): Promise<void> {
    const hostId = await this.hostId();
    const previous = await this.credentials();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    let resolveCallback!: (value: { code: string; clientId: string }) => void;
    let rejectCallback!: (error: Error) => void;
    const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    // Attach a handler immediately, including while opening the browser.
    void callback.catch(() => undefined);
    let consumed = false;
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/auth/callback") {
          response.writeHead(404).end();
          return;
        }
        if (consumed) {
          response.writeHead(409).end("Callback already handled.");
          return;
        }
        if (url.searchParams.get("state") === state && url.searchParams.has("error")) {
          consumed = true;
          rejectCallback(new Error("ChatGPT authorization declined or failed."));
          response.writeHead(400).end("Authorization declined. Return to Survey Agent.");
          return;
        }
        const value = validateCallback(url, state, previous?.clientId);
        consumed = true;
        response.setHeader("content-type", "text/plain");
        response.end("Return to Survey Agent to finish sign-in.");
        resolveCallback(value);
      } catch {
        response.writeHead(400).end("Authorization callback rejected.");
        // Invalid state must not cancel a legitimate pending attempt.
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/callback`;
    const timer = setTimeout(
      () => rejectCallback(new Error("ChatGPT sign-in timed out.")),
      180_000
    );
    try {
      await openBrowser(
        authorizationUrl(hostId, redirectUri, state, nonce, verifier, previous).href
      );
      const { code, clientId } = await callback;
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          resource
        })
      });
      if (!response.ok) throw new Error(`ChatGPT sign-in failed (HTTP ${response.status}).`);
      const tokens = tokenSchema.parse(await response.json());
      if (!tokens.id_token || !tokens.refresh_token)
        throw new Error("Incomplete ChatGPT token response.");
      const subject = await verifyIdentity(tokens.id_token, clientId, nonce);
      if (previous && subject !== previous.subject)
        throw new Error("ChatGPT account changed; use a different account label.");
      const scopes = (tokens.scope ?? "").split(" ").filter(Boolean);
      if (!scopes.includes("chatgpt.tokens.use.direct"))
        throw new Error("ChatGPT plan usage was not authorized.");
      await atomicSave(this.credentialPath, {
        clientId,
        subject,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scopes
      });
    } finally {
      clearTimeout(timer);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  public async accessToken(): Promise<string> {
    const saved = await this.credentials();
    if (!saved || !saved.scopes.includes("chatgpt.tokens.use.direct"))
      throw new Error("Run chatgpt-login to authorize ChatGPT plan usage.");
    if (saved.expiresAt > Date.now() + 60_000) return saved.accessToken;
    // A lock prevents concurrent processes from racing rotating refresh tokens.
    const lock = `${this.credentialPath}.lock`;
    await writeFile(lock, "refreshing", { flag: "wx", mode: 0o600 });
    try {
      const latest = await this.credentials();
      if (!latest) throw new Error("ChatGPT session missing.");
      if (latest.expiresAt > Date.now() + 60_000) return latest.accessToken;
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: latest.clientId,
          refresh_token: latest.refreshToken,
          resource
        })
      });
      if (!response.ok)
        throw new Error(`ChatGPT session renewal failed (HTTP ${response.status}); sign in again.`);
      const tokens = tokenSchema.parse(await response.json());
      const scopes = tokens.scope === undefined ? latest.scopes : tokens.scope.split(" ");
      if (!scopes.includes("chatgpt.tokens.use.direct"))
        throw new Error("ChatGPT plan permission revoked.");
      const updated = {
        ...latest,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? latest.refreshToken,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scopes
      };
      await atomicSave(this.credentialPath, updated);
      return updated.accessToken;
    } finally {
      await unlink(lock);
    }
  }
}
