#!/usr/bin/env bash
#
# provision-tenants.sh — OpenClaw AaaS tenant provisioning
# Usage: sudo VM_HOST=<public-ip-or-dns> ./provision-tenants.sh [tenants.json]
#
set -euo pipefail

TENANTS_FILE="${1:-tenants.json}"
TENANT_ROOT_BASE="/srv/openclaw-tenants"
KEYS_DIR="$(pwd)/keys"
GENERATED_DIR="$(pwd)/generated"
TENANT_ID_REGEX='^tnt_[a-zA-Z0-9_-]+$'

# ----- helpers -----
log()  { echo "[INFO]  $*"; }
warn() { echo "[WARN]  $*" >&2; }
err()  { echo "[ERROR] $*" >&2; }

# ----- preconditions -----
if [ "$EUID" -ne 0 ]; then
  err "Run with sudo: sudo VM_HOST=... $0 $*"; exit 1
fi
if [ ! -f "$TENANTS_FILE" ]; then
  err "tenants.json not found: $TENANTS_FILE"; exit 1
fi
command -v jq >/dev/null || { err "jq not installed. sudo apt install -y jq"; exit 1; }

if ! jq empty "$TENANTS_FILE" 2>/dev/null; then
  err "Invalid JSON: $TENANTS_FILE"; exit 1
fi

USER_COUNT=$(jq '.users | length' "$TENANTS_FILE")
[ "$USER_COUNT" -gt 0 ] || { err "tenants.json has no users"; exit 1; }

DUP=$(jq -r '.users[].tenantId' "$TENANTS_FILE" | sort | uniq -d)
[ -z "$DUP" ] || { err "Duplicate tenantId(s): $DUP"; exit 1; }

if [ -z "${VM_HOST:-}" ]; then
  VM_HOST=$(hostname -I | awk '{print $1}')
  warn "VM_HOST not set; using detected $VM_HOST"
  warn "For external clients pass the PUBLIC IP: VM_HOST=<public-ip> sudo -E $0"
fi

mkdir -p "$KEYS_DIR" "$GENERATED_DIR" "$TENANT_ROOT_BASE"
chown "$SUDO_USER:$SUDO_USER" "$KEYS_DIR" "$GENERATED_DIR" 2>/dev/null || true
chmod 755 "$TENANT_ROOT_BASE"

log "Tenants file:    $TENANTS_FILE"
log "Tenant root:     $TENANT_ROOT_BASE"
log "Keys dir:        $KEYS_DIR"
log "Generated dir:   $GENERATED_DIR"
log "VM_HOST:         $VM_HOST"
echo

# ----- main loop (process substitution to avoid subshell exit issue) -----
while read -r entry; do
  USER_ID=$(echo "$entry"  | jq -r '.userId')
  TENANT_ID=$(echo "$entry" | jq -r '.tenantId')

  log "=== $USER_ID  ($TENANT_ID) ==="

  # 1. validate
  if ! [[ "$TENANT_ID" =~ $TENANT_ID_REGEX ]]; then
    err "Invalid tenantId '$TENANT_ID' (must match $TENANT_ID_REGEX)"; exit 1
  fi

  # 2. linux user (idempotent)
  if id "$TENANT_ID" >/dev/null 2>&1; then
    log "  user exists: $TENANT_ID"
  else
    useradd --create-home --shell /bin/bash "$TENANT_ID"
    log "  created user: $TENANT_ID"
  fi

  # 3,4. workspace + owner/mode
  TENANT_ROOT="$TENANT_ROOT_BASE/$TENANT_ID"
  mkdir -p "$TENANT_ROOT/sandboxes" "$TENANT_ROOT/workspace"
  chown -R "$TENANT_ID:$TENANT_ID" "$TENANT_ROOT"
  chmod 700 "$TENANT_ROOT"
  log "  workspace: $TENANT_ROOT (owner=$TENANT_ID, mode=700)"

  # 5. ssh keypair
  KEY_NAME="openclaw_aaas_$TENANT_ID"
  KEY_FILE="$KEYS_DIR/$KEY_NAME"
  if [ -f "$KEY_FILE" ]; then
    log "  ssh key exists: $KEY_FILE"
  else
    sudo -u "$SUDO_USER" ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" \
      -C "openclaw-aaas-$TENANT_ID" >/dev/null
    log "  generated ssh key: $KEY_FILE"
  fi

  # 6. authorized_keys
  SSH_DIR="/home/$TENANT_ID/.ssh"
  mkdir -p "$SSH_DIR"
  cp "$KEY_FILE.pub" "$SSH_DIR/authorized_keys"
  chown -R "$TENANT_ID:$TENANT_ID" "$SSH_DIR"
  chmod 700 "$SSH_DIR"
  chmod 600 "$SSH_DIR/authorized_keys"
  log "  authorized_keys installed"

  # 7. openclaw config snippet (Phase 4 preview)
  SNIPPET="$GENERATED_DIR/openclaw-config-$TENANT_ID.json5"
  cat > "$SNIPPET" <<EOF
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        backend: "ssh",
        scope: "session",
        workspaceAccess: "rw",
        ssh: {
          target: "$TENANT_ID@$VM_HOST:22",
          workspaceRoot: "$TENANT_ROOT/sandboxes",
          strictHostKeyChecking: true,
          updateHostKeys: true,
          identityFile: "~/.ssh/$KEY_NAME",
          knownHostsFile: "~/.ssh/known_hosts"
        }
      }
    }
  }
}
EOF
  log "  snippet: $SNIPPET"
  echo
done < <(jq -c '.users[]' "$TENANTS_FILE")

log "Done. Files to distribute:"
echo
echo "  Private keys (one per user, KEEP SECRET):"
ls -1 "$KEYS_DIR"/openclaw_aaas_* | grep -v '\.pub$' || true
echo
echo "  Config snippets:"
ls -1 "$GENERATED_DIR"/openclaw-config-*.json5 || true