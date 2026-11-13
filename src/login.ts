/**
 * `npx @unblockingapi/mcp login`: the device-code sign-in (src/device.ts) for a
 * terminal. Prints a link and a code, waits for the approval in the browser,
 * and saves the key where the stdio server looks for it. Never prints the key.
 */
import { saveKey, startDeviceGrant, waitForApproval } from "./device.js";

export async function login(out: NodeJS.WritableStream = process.stdout): Promise<number> {
  try {
    const grant = await startDeviceGrant("UnblockingAPI MCP (terminal login)");
    out.write(
      `\nOpen ${grant.verification_uri_complete}\nand approve the code  ${grant.user_code}\n` +
        `(sign in or create an account there; new accounts get 500 free credits once they confirm their email)\n\n` +
        `Waiting for approval…\n`,
    );
    const result = await waitForApproval(grant, { budgetMs: grant.expires_in * 1000 });
    if (result.status === "approved") {
      const path = await saveKey(result.apiKey);
      out.write(`Signed in. Key saved to ${path}; the MCP server uses it when UNBLOCKINGAPI_KEY is not set.\n`);
      return 0;
    }
    out.write(result.status === "access_denied" ? "Declined in the browser. Nothing was saved.\n" : "The code expired. Run login again.\n");
    return 1;
  } catch (err) {
    out.write(`Sign-in failed: ${(err as Error).message}\n`);
    return 1;
  }
}
