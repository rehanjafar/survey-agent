import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { authorizationUrl, validateCallback, ChatGPTAuth } from "../../src/auth/chatgpt-auth.js";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
it("uses scoped PKCE dynamic registration and binds callback state/client", () => {
  const url = authorizationUrl(
    "urn:uuid:test",
    "http://127.0.0.1:1234/auth/callback",
    "state",
    "nonce",
    "verifier"
  );
  expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
  expect(url.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(
    validateCallback(
      new URL("http://127.0.0.1/auth/callback?state=state&code=test&client_id=oaiapp_test"),
      "state"
    )
  ).toEqual({ code: "test", clientId: "oaiapp_test" });
  expect(() =>
    validateCallback(
      new URL("http://127.0.0.1/auth/callback?state=wrong&code=test&client_id=oaiapp_test"),
      "state"
    )
  ).toThrow();
  expect(() =>
    validateCallback(
      new URL("http://127.0.0.1/auth/callback?state=state&code=test&client_id=other"),
      "state",
      "oaiapp_test"
    )
  ).toThrow();
  expect(() =>
    validateCallback(
      new URL("http://127.0.0.1/auth/callback?state=state&error=access_denied"),
      "state"
    )
  ).toThrow("declined");
});
it("renews and atomically protects credentials without revealing them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chatgpt-auth-"));
  directories.push(directory);
  const path = join(directory, "chatgpt-default.json");
  await writeFile(
    path,
    JSON.stringify({
      clientId: "oaiapp_test",
      subject: "subject",
      accessToken: "old",
      refreshToken: "refresh",
      idToken: "identity",
      expiresAt: 0,
      scopes: ["chatgpt.tokens.use.direct"]
    })
  );
  const fetchMock = vi.fn(async () =>
    Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 })
  );
  vi.stubGlobal("fetch", fetchMock);
  const auth = new ChatGPTAuth(directory);
  expect(await auth.accessToken()).toBe("new");
  expect(await auth.accessToken()).toBe("new");
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    refreshToken: "rotated",
    clientId: "oaiapp_test"
  });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});
it("rejects missing plan consent without making inference requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chatgpt-auth-"));
  directories.push(directory);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(new ChatGPTAuth(directory).accessToken()).rejects.toThrow("authorize");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("verifies the ID-token signature, issuer, audience and nonce", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { verifyIdentity } = await import("../../src/auth/chatgpt-auth.js");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }] }))
  );
  const signed = await new SignJWT({ nonce: "expected" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://auth.openai.com")
    .setAudience("oaiapp_test")
    .setSubject("subject")
    .setExpirationTime("1h")
    .sign(privateKey);
  await expect(verifyIdentity(signed, "oaiapp_test", "expected")).resolves.toBe("subject");
  await expect(verifyIdentity(signed, "other", "expected")).rejects.toThrow();
  await expect(verifyIdentity(signed, "oaiapp_test", "wrong")).rejects.toThrow("nonce");
});
