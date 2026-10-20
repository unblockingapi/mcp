#!/usr/bin/env sh
# Packs the package and starts it the way every install guide does,
# `npx -y <package>`, from the tarball. Catches a package that installs but
# that npx cannot run: with more than one bin, npx only runs the one named
# after the package (`mcp` for @unblockingapi/mcp) - 0.6.0-0.8.0 shipped
# without it and every `npx -y @unblockingapi/mcp` failed (issue #7).
set -eu
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
tgz=$(npm pack --silent --pack-destination "$dir" | tail -1)
cd "$dir"
# Closed stdin: the stdio server starts, logs to stderr and exits at EOF.
out=$(npx -y "file:$dir/$tgz" </dev/null 2>&1 || true)
echo "$out" | tail -3
echo "$out" | grep -q "started (stdio)" || { echo "FAIL  npx -y could not start the server"; exit 1; }
echo "PASS  npx -y starts the stdio server"
