#!/usr/bin/env python3
"""Offline regressions: Compose plugin and Bash only; no daemon, builds or keys."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
# Do not inherit keys, port overrides, Compose variables, or a developer .env.
ENV = {key: value for key, value in os.environ.items()
       if key in {"PATH", "HOME", "DOCKER_CONFIG", "TMPDIR"}}


def config(mode, env_file="/dev/null", **overrides):
    file = "compose.yaml" if mode == "dev" else "compose.prod.yaml"
    return subprocess.run(
        ["docker", "compose", "--env-file", str(env_file), "--file",
         str(ROOT / "infrastructure" / file), "config", "--format", "json"],
        env={**ENV, **overrides}, capture_output=True, text=True, check=False,
    )


def check_smoke_shell():
    script = (ROOT / "infrastructure/scripts/verify-compose.sh").read_text()
    helpers = script[script.index('RESPONSE_DIR="'):script.index("wait_for_ai_health_failure() {")]
    done = script[script.index('echo "Compose verification passed:'):]
    setup = '''set -Eeuo pipefail
WAIT_TIMEOUT_SECONDS=1
WAIT_INTERVAL_SECONDS=0
KEEP_RUNNING=false
MODE=dev
compose_stub() { :; }
COMPOSE=(compose_stub)
curl() { printf 'alpha beta\\n' >"${LAST_RESPONSE_FILE}"; printf 200; }
'''
    cases = [
        ("zero body patterns", 'wait_for_http test unused 200\n' + done, 0),
        ("one body pattern", 'wait_for_http test unused 200 alpha\n' + done, 0),
        ("multiple body patterns", 'wait_for_http test unused 200 alpha beta\n' + done, 0),
        ("required pattern mismatch", 'wait_for_http test unused 200 alpha missing\n' + done, 1),
        ("incomplete nounset termination", 'true\nprintf "%s" "$UNSET_SMOKE_VARIABLE"\n', 1),
        ("dev completion", done, 0),
        ("prod completion", 'MODE=prod\n' + done, 0),
        ("explicit failure preserved", 'exit 7\n', 7),
    ]
    failures = []
    for name, commands, expected in cases:
        result = subprocess.run(["/bin/bash", "-c", setup + helpers + commands],
                                env=ENV, capture_output=True, text=True, timeout=10)
        passed = result.returncode == expected
        if name in {"zero body patterns", "one body pattern", "multiple body patterns"}:
            passed = passed and "Verified test: HTTP 200" in result.stdout
        print(f"{'PASS' if passed else 'FAIL'}: {name}: exit {result.returncode}, expected {expected}")
        if not passed:
            failures.append(f"{name}: {result.stderr}")
    assert not failures, "\n".join(failures)


check_smoke_shell()

for mode in ("dev", "prod"):
    for env_file in ("/dev/null", ROOT / ".env.example"):
        result = config(mode, env_file=env_file)
        assert result.returncode == 0, "Compose defaults must work without a key"
        services = json.loads(result.stdout)["services"]
        assert set(services) == {"web", "core-api", "ai-service"}
        web, core, ai = (services[name] for name in ("web", "core-api", "ai-service"))
        example_port = "5173" if mode == "dev" else "8088"
        assert web["ports"][0]["host_ip"] == "127.0.0.1"
        assert str(web["ports"][0]["published"]) == example_port
        assert ai["environment"] == {"OPENAI_API_KEY": "", "OPENAI_MODEL": "gpt-5.6-luna"}
        assert core["environment"] == {
            "AI_SERVICE_BASE_URL": "http://ai-service:8000",
            "AI_SERVICE_CONNECT_TIMEOUT": "1s",
            "AI_SERVICE_READ_TIMEOUT": "12s",
            "APP_CORS_ALLOWED_ORIGIN": f"http://127.0.0.1:{example_port}",
        }
    for changed in (False, True):
        ports = {"DEV_WEB_PORT": "25173", "CORE_API_PORT": "28080", "WEB_PORT": "28088"} if changed else {}
        result = config(mode, OPENAI_API_KEY="config-only-synthetic-key",
                        AI_SERVICE_BASE_URL="http://must-not-be-used:9999",
                        AI_SERVICE_CONNECT_TIMEOUT="3s", **ports)
        assert result.returncode == 0, "Compose override configuration failed"
        model = json.loads(result.stdout)
        assert model["name"] == ("storyfork-dev" if mode == "dev" else "storyfork-prod-validation")
        services = model["services"]
        assert set(services) == {"web", "core-api", "ai-service"}
        web, core, ai = (services[name] for name in ("web", "core-api", "ai-service"))
        expected_port = ports.get("DEV_WEB_PORT", "5173") if mode == "dev" else ports.get("WEB_PORT", "8088")
        assert web["ports"][0]["host_ip"] == "127.0.0.1"
        assert str(web["ports"][0]["published"]) == expected_port
        assert core["environment"]["APP_CORS_ALLOWED_ORIGIN"] == f"http://127.0.0.1:{expected_port}"
        assert core["environment"]["AI_SERVICE_BASE_URL"] == "http://ai-service:8000"
        assert core["environment"]["AI_SERVICE_CONNECT_TIMEOUT"] == "3s"
        assert not ai.get("ports")
        for name, service in services.items():
            environment = service.get("environment", {})
            assert ("OPENAI_API_KEY" in environment) == (name == "ai-service")
            assert ("OPENAI_MODEL" in environment) == (name == "ai-service")
            assert "config-only-" not in json.dumps(service.get("build", {}))
            assert not service.get("env_file")
        if mode == "dev":
            assert str(core["ports"][0]["published"]) == ports.get("CORE_API_PORT", "8080")
            assert core["ports"][0]["host_ip"] == "127.0.0.1"
            assert web["environment"]["VITE_CORE_API_BASE_URL"] == "/"
            assert web["environment"]["VITE_DEV_PROXY_TARGET"] == "http://core-api:8080"
            assert web["build"]["dockerfile"] == "Dockerfile.dev" and web.get("volumes")
        else:
            assert not core.get("ports")
            assert web["build"]["dockerfile"] == "Dockerfile"
            assert all(not service.get("volumes") for service in services.values())
            assert all(not service.get("command") for service in services.values())
    override = config(mode, APP_CORS_ALLOWED_ORIGIN="https://explicit.example")
    assert override.returncode == 0, "Explicit CORS configuration failed"
    assert json.loads(override.stdout)["services"]["core-api"]["environment"]["APP_CORS_ALLOWED_ORIGIN"] == "https://explicit.example"
print("PASS: dev/prod three services, empty-key defaults, example, ports/CORS, secret boundaries, internal DNS, static isolation")
subprocess.run(["python3", str(ROOT / "infrastructure/scripts/test-run-native.py")], check=True)
