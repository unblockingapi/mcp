#!/usr/bin/env node
// PreToolUse hook: deny Claude's built-in WebFetch and point it at unblock_fetch.
//
// Stays silent (exit 0, no decision) when no UnblockingAPI key is configured,
// so a half-installed plugin never leaves Claude without any way to read a page.
const key = [
  process.env.CLAUDE_PLUGIN_OPTION_API_KEY,
  process.env.CLAUDE_PLUGIN_OPTION_api_key,
].find((v) => v && v.trim() && !v.startsWith("${"));
if (!key) process.exit(0);

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let url = "";
  try {
    url = String(JSON.parse(raw)?.tool_input?.url ?? "");
  } catch {
    // Malformed input: still deny, just without echoing the URL.
  }
  const reason =
    `Use the UnblockingAPI tool mcp__plugin_unblockingapi_unblockingapi__unblock_fetch ` +
    `instead of WebFetch${url ? ` for ${url}` : ""}. Leave render unset: it fetches plainly first and ` +
    `switches to a real browser when the page needs JavaScript or refuses automated requests.`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
});
