#!/usr/bin/env bash
# Smoke test for the AaaS Gateway.
# Assumes docker-compose stack is running on localhost:8080.

set -euo pipefail

GATEWAY="${GATEWAY:-http://localhost:8080}"
TOKEN_A="${TOKEN_A:-aaas_demo_token_userA_change_me}"
TOKEN_B="${TOKEN_B:-aaas_demo_token_userB_change_me}"

bold() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

bold "healthz"
curl -sS "$GATEWAY/healthz" | tee /dev/stderr; echo

bold "userA runs file-summarizer (should see workspace=/workspaces/userA)"
curl -sS -X POST "$GATEWAY/v1/agents/run" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"file-summarizer","input":"Summarize hello.txt in my workspace"}'
echo

bold "userB runs file-summarizer (should see workspace=/workspaces/userB)"
curl -sS -X POST "$GATEWAY/v1/agents/run" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"file-summarizer","input":"Summarize hello.txt in my workspace"}'
echo

bold "userB tries shell-runner (should be 403: agent_not_allowed)"
curl -sS -o /dev/stderr -w "HTTP %{http_code}\n" -X POST "$GATEWAY/v1/agents/run" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"shell-runner","input":"ls /"}'

bold "userA tries to inject workspace_path via metadata (should be ignored)"
curl -sS -X POST "$GATEWAY/v1/agents/run" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{
        "agent_id":"file-summarizer",
        "input":"What workspace am I in?",
        "metadata": { "workspace_path": "/workspaces/userB" }
      }'
echo

bold "Invalid token (should be 401)"
curl -sS -o /dev/stderr -w "HTTP %{http_code}\n" -X POST "$GATEWAY/v1/agents/run" \
  -H "Authorization: Bearer obviously-wrong" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"file-summarizer","input":"hi"}'

bold "admin stats"
curl -sS "$GATEWAY/admin/stats" | tee /dev/stderr; echo
