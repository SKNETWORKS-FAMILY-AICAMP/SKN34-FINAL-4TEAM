#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INFRASTRUCTURE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MODE="${1:-dev}"
case "${MODE}" in
  dev) COMPOSE_FILE="${INFRASTRUCTURE_DIR}/compose.yaml" ;;
  prod) COMPOSE_FILE="${INFRASTRUCTURE_DIR}/compose.prod.yaml" ;;
  *) printf 'Usage: %s [dev|prod]\n' "$0" >&2; exit 2 ;;
esac
WAIT_TIMEOUT_SECONDS="${VERIFY_COMPOSE_TIMEOUT_SECONDS:-120}"
WAIT_INTERVAL_SECONDS="${VERIFY_COMPOSE_INTERVAL_SECONDS:-2}"
KEEP_RUNNING="${VERIFY_COMPOSE_KEEP_RUNNING:-false}"
PROJECT_NAME="${VERIFY_COMPOSE_PROJECT_NAME:-storyfork-verify-${MODE}-$$}"
export DEV_WEB_PORT="${DEV_WEB_PORT:-15173}"
export CORE_API_PORT="${CORE_API_PORT:-18080}"
export WEB_PORT="${WEB_PORT:-18088}"
if [[ "${MODE}" == "prod" ]]; then
  WEB_URL="http://127.0.0.1:${WEB_PORT}"
else
  WEB_URL="http://127.0.0.1:${DEV_WEB_PORT}"
fi
export APP_CORS_ALLOWED_ORIGIN="${WEB_URL}"

# Never load a developer .env or use a real/fake API key.
export OPENAI_API_KEY=""
export OPENAI_MODEL="gpt-5.6-luna"
export AI_SERVICE_CONNECT_TIMEOUT="1s"
export AI_SERVICE_READ_TIMEOUT="12s"

COMPOSE=(
  docker compose
  --env-file /dev/null
  --project-name "${PROJECT_NAME}"
  --file "${COMPOSE_FILE}"
)
# Refuse to reuse ANY existing project resources before installing the cleanup trap.
for resource in container network volume; do
  list_flags=(--quiet)
  [[ "${resource}" != "container" ]] || list_flags+=(--all)
  existing="$(docker "${resource}" ls "${list_flags[@]}" --filter "label=com.docker.compose.project=${PROJECT_NAME}")"
  if [[ -n "${existing}" ]]; then
    printf 'Refusing existing Compose project: %s\n' "${PROJECT_NAME}" >&2
    exit 1
  fi
done
RESPONSE_DIR="$(mktemp -d)"
LAST_RESPONSE_FILE="${RESPONSE_DIR}/last-response"
VERIFICATION_COMPLETE=false

cleanup() {
  local exit_code=$?
  trap - EXIT

  # Bash 3.2 can report status zero after a fatal nounset expansion.
  if [[ "${VERIFICATION_COMPLETE}" != "true" ]] && ((exit_code == 0)); then
    exit_code=1
  fi

  if ((exit_code != 0)); then
    echo "Compose verification failed. Current services (no raw log dump):" >&2
    "${COMPOSE[@]}" ps >&2 || true
  fi

  if [[ "${KEEP_RUNNING}" != "true" ]]; then
    "${COMPOSE[@]}" down --volumes >/dev/null 2>&1 || true
  fi

  rm -rf -- "${RESPONSE_DIR}"
  exit "${exit_code}"
}

trap cleanup EXIT

wait_for_http() {
  local label=$1
  local url=$2
  local expected_status=$3
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local actual_status="000"
  local body_matches
  local pattern

  while ((SECONDS < deadline)); do
    : >"${LAST_RESPONSE_FILE}"
    actual_status="$(
      curl \
        --silent \
        --output "${LAST_RESPONSE_FILE}" \
        --write-out '%{http_code}' \
        --max-time 5 \
        "${url}" || true
    )"

    if [[ "${actual_status}" == "${expected_status}" ]]; then
      body_matches=true
      for pattern in "${@:4}"; do
        if [[ -n "${pattern}" ]] && ! grep -Eq "${pattern}" "${LAST_RESPONSE_FILE}"; then
          body_matches=false
          break
        fi
      done

      if [[ "${body_matches}" == "true" ]]; then
        echo "Verified ${label}: HTTP ${actual_status}"
        return 0
      fi
    fi

    echo "Waiting for ${label}: expected HTTP ${expected_status}, received ${actual_status}"
    sleep "${WAIT_INTERVAL_SECONDS}"
  done

  echo "Timed out waiting for ${label}: expected HTTP ${expected_status}, received ${actual_status}" >&2
  return 1
}

wait_for_ai_health_failure() {
  local url=$1
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local actual_status="000"

  while ((SECONDS < deadline)); do
    : >"${LAST_RESPONSE_FILE}"
    actual_status="$(
      curl \
        --silent \
        --output "${LAST_RESPONSE_FILE}" \
        --write-out '%{http_code}' \
        --max-time 5 \
        "${url}" || true
    )"

    if [[ "${actual_status}" == "503" ]] \
        && grep -Eq '"code"[[:space:]]*:[[:space:]]*"AI_SERVICE_UNAVAILABLE"' "${LAST_RESPONSE_FILE}"; then
      echo "Verified Core to AI Service failure contract: HTTP 503 unavailable"
      return 0
    fi
    if [[ "${actual_status}" == "504" ]] \
        && grep -Eq '"code"[[:space:]]*:[[:space:]]*"AI_SERVICE_TIMEOUT"' "${LAST_RESPONSE_FILE}"; then
      echo "Verified Core to AI Service failure contract: HTTP 504 timeout"
      return 0
    fi

    echo "Waiting for Core to AI Service failure contract: received ${actual_status}"
    sleep "${WAIT_INTERVAL_SECONDS}"
  done

  echo "Timed out waiting for Core to AI Service unavailable/timeout contract" >&2
  return 1
}

echo "Validating Compose configuration"
"${COMPOSE[@]}" config --quiet

echo "Building and starting the ${MODE} verification stack (${PROJECT_NAME})"
"${COMPOSE[@]}" up --build --detach

if [[ "${MODE}" == "prod" ]]; then
  wait_for_http "Static web" "${WEB_URL}/" "200" '<div id="root">'
  cp "${LAST_RESPONSE_FILE}" "${RESPONSE_DIR}/index.html"
  wait_for_http "SPA deep link" "${WEB_URL}/unknown" "200" '<div id="root">'
  cmp "${RESPONSE_DIR}/index.html" "${LAST_RESPONSE_FILE}"
  asset="$(grep -Eo '/assets/[^" ]+\.js' "${RESPONSE_DIR}/index.html" | sort -u)"
  [[ -n "${asset}" && "${asset}" != *$'\n'* ]]
  wait_for_http "Built JavaScript asset" "${WEB_URL}${asset}" "200"
  wait_for_http "Missing static asset" "${WEB_URL}/assets/does-not-exist.js" "404"
else
  wait_for_http "Vite web" "${WEB_URL}/" "200" '<div id="root">'
fi

wait_for_http "Core health" "${WEB_URL}/api/v1/health" "200" '"status"[[:space:]]*:[[:space:]]*"up"' '"service"[[:space:]]*:[[:space:]]*"storyfork-core-api"'
wait_for_http "AI health via Core" "${WEB_URL}/api/v1/health/ai-service" "200" '"status"[[:space:]]*:[[:space:]]*"up"' '"service"[[:space:]]*:[[:space:]]*"storyfork-ai-service"'
for path in /api/v1/does-not-exist /api/v1/support-programs/search /api/v1/sample-items/prepare; do
  wait_for_http "Absent API" "${WEB_URL}${path}" "404"
  if grep -q '<div id="root">' "${LAST_RESPONSE_FILE}"; then
    printf 'API 404 incorrectly returned the SPA\n' >&2
    exit 1
  fi
done

# The former preparation endpoint used POST, so verify that method too.
post_status="$(curl --silent --output "${LAST_RESPONSE_FILE}" --write-out '%{http_code}' --max-time 5 --request POST --header 'Content-Type: application/json' --data '{}' "${WEB_URL}/api/v1/sample-items/prepare")"
[[ "${post_status}" == "404" ]]
! grep -q '<div id="root">' "${LAST_RESPONSE_FILE}"

echo "Stopping only AI Service to verify failure isolation"
"${COMPOSE[@]}" stop ai-service
wait_for_http "Core health while AI is stopped" "${WEB_URL}/api/v1/health" "200" 'storyfork-core-api'
wait_for_ai_health_failure "${WEB_URL}/api/v1/health/ai-service"

echo "Restarting AI Service to verify recovery without restarting Core"
"${COMPOSE[@]}" start ai-service
wait_for_http "AI recovery" "${WEB_URL}/api/v1/health/ai-service" "200" 'storyfork-ai-service'

echo "Compose verification passed: startup, health, API absence, isolation, and recovery (${MODE}; no model call)."
VERIFICATION_COMPLETE=true
