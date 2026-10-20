# Docker MCP Catalog entries

Ready-to-submit entries for [docker/mcp-registry](https://github.com/docker/mcp-registry):
copy each folder into its `servers/` and open one PR.

- `unblockingapi/`: the local server, built by Docker from `Dockerfile.stdio`
  and run as `docker run -i` with the key as the `unblockingapi.api_key`
  secret. It lists its tools without a key, so no `tools.json` is needed.
- `unblockingapi-remote/`: the hosted server at `https://mcp.unblockingapi.com/mcp`,
  signed in with OAuth (dynamic client registration).

Bump `source.commit` in `unblockingapi/server.yaml` to the release commit
before submitting; Docker rebuilds the image from that commit.
