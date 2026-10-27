"""Run one native service with only its settings from the root .env (requires uv)."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = {
    "web": ("VITE_CORE_API_BASE_URL", "VITE_DEV_PROXY_TARGET", "CHOKIDAR_USEPOLLING"),
    "core-api": ("AI_SERVICE_BASE_URL", "AI_SERVICE_CONNECT_TIMEOUT", "AI_SERVICE_READ_TIMEOUT", "APP_CORS_ALLOWED_ORIGIN"),
    "ai-service": ("OPENAI_API_KEY", "OPENAI_MODEL"),
}
COMMANDS = {
    "web": ("frontend", ["pnpm", "dev"]),
    "core-api": ("backend/core-api", ["./gradlew", "bootRun"]),
    "ai-service": ("backend/ai-service", ["uv", "run", "--locked", "python", "-m", "uvicorn", "app.main:create_app", "--factory", "--reload", "--port", "8000"]),
}


def service_environment(service, values):
    env = dict(os.environ)
    for key in {key for keys in SETTINGS.values() for key in keys}:
        env.pop(key, None)
    env.update({key: values[key] for key in SETTINGS[service] if values.get(key)})
    return env


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in SETTINGS:
        sys.exit("Usage: python3 infrastructure/scripts/run-native.py web|core-api|ai-service")
    service = sys.argv[1]
    keys = SETTINGS[service]
    # uv parses dotenv; only the selected service's allowlist leaves this subprocess.
    code = "import os,json; print(json.dumps({k:os.environ[k] for k in " + repr(keys) + " if k in os.environ}))"
    command = ["uv", "run", "--no-project"]
    if (ROOT / ".env").exists():
        command += ["--env-file", str(ROOT / ".env")]
    command += [sys.executable, "-c", code]
    try:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("uv is required; install uv before running native services.")
    if result.returncode:
        sys.exit("Root .env loading failed; check uv installation and dotenv syntax (values suppressed).")
    env = service_environment(service, json.loads(result.stdout))
    directory, args = COMMANDS[service]
    os.chdir(ROOT / directory)
    os.execvpe(args[0], args, env)


if __name__ == "__main__":
    main()
