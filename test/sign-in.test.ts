import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server } from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { UnblockingApiClient } from "../src/client.js";
import { credentialsPath, readSavedKey, saveKey } from "../src/device.js";

const KEY = "a".repeat(64);

/** A stand-in for app.unblockingapi.com's /device endpoints. */
async function fakeApp(answers: string[]): Promise<{ url: string; server: Server; codes: string[] }> {
  const codes: string[] = [];
  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/device/code") {
        codes.push(JSON.parse(body).client_name);
        res.end(JSON.stringify({
          device_code: "dev-secret", user_code: "BCDF-GHJK", verification_uri: "https://app.test/device",
          verification_uri_complete: "https://app.test/device?user_code=BCDF-GHJK", expires_in: 600, interval: 0,
        }));
      } else {
        const answer = answers.shift() ?? "authorization_pending";
        res.statusCode = answer === "approved" ? 200 : 400;
        res.end(JSON.stringify(answer === "approved" ? { api_key: KEY } : { error: answer }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, server, codes };
}

async function connect(apiClient: UnblockingApiClient, appUrl: string, saved: string[]) {
  const server = createServer(apiClient, {
    signIn: { appUrl, waitMs: 300, clientName: "test agent", saveKey: async (k) => { saved.push(k); return "/tmp/creds"; } },
  });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

test("sign_in gives a link and code, then sets the key without showing it", async () => {
  const app = await fakeApp(["authorization_pending", "approved"]);
  const apiClient = new UnblockingApiClient({ apiKey: "" });
  const saved: string[] = [];
  const client = await connect(apiClient, app.url, saved);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "sign_in"));

    const first = textOf(await client.callTool({ name: "sign_in", arguments: {} }));
    assert.match(first, /https:\/\/app\.test\/device\?user_code=BCDF-GHJK/);
    assert.match(first, /BCDF-GHJK/);
    assert.deepEqual(app.codes, ["test agent"]);

    const done = await client.callTool({ name: "sign_in", arguments: {} });
    assert.ok(!done.isError);
    assert.match(textOf(done), /Signed in/);
    assert.ok(!textOf(done).includes(KEY), "the key never reaches the model");
    assert.equal(apiClient.apiKey, KEY);
    assert.deepEqual(saved, [KEY]);

    assert.match(textOf(await client.callTool({ name: "sign_in", arguments: {} })), /Already signed in/);
  } finally {
    app.server.close();
  }
});

test("sign_in says so when the person declines, and starts over next time", async () => {
  const app = await fakeApp(["access_denied"]);
  const client = await connect(new UnblockingApiClient({ apiKey: "" }), app.url, []);
  try {
    await client.callTool({ name: "sign_in", arguments: {} });
    const declined = await client.callTool({ name: "sign_in", arguments: {} });
    assert.ok(declined.isError);
    assert.match(textOf(declined), /declined/);

    await client.callTool({ name: "sign_in", arguments: {} });
    assert.equal(app.codes.length, 2, "a new code after a refusal");
  } finally {
    app.server.close();
  }
});

test("sign_in keeps waiting while the approval is pending", async () => {
  const app = await fakeApp([]);
  const client = await connect(new UnblockingApiClient({ apiKey: "" }), app.url, []);
  try {
    await client.callTool({ name: "sign_in", arguments: {} });
    const waiting = await client.callTool({ name: "sign_in", arguments: {} });
    assert.ok(!waiting.isError);
    assert.match(textOf(waiting), /Still waiting/);
    assert.equal(app.codes.length, 1, "the same code while it is still valid");
  } finally {
    app.server.close();
  }
});

test("the hosted shape (no signIn option) has no sign_in tool", async () => {
  const server = createServer(new UnblockingApiClient({ apiKey: "" }));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  assert.ok(!tools.some((t) => t.name === "sign_in"));
});

test("the saved key is private to the user and read back", async () => {
  const env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "uba-")) } as NodeJS.ProcessEnv;
  assert.equal(readSavedKey(env), "");
  const path = await saveKey(KEY, env);
  assert.equal(path, credentialsPath(env));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).api_key, KEY);
  assert.equal(readSavedKey(env), KEY);
});
