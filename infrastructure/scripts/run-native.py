"""Run one native service with only its settings from the root .env (requires uv)."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = {
    "web": ("VITE_CORE_API_BASE_URL", "VITE_DEV_PROXY_TARGET", "CHOKIDAR_USEPOLLING", "VITE_DEV_SERVER_HOST"),
    "core-api": ("AI_SERVICE_BASE_URL", "AI_SERVICE_CONNECT_TIMEOUT", "AI_SERVICE_READ_TIMEOUT", "AI_GENERATION_READ_TIMEOUT", "APP_CORS_ALLOWED_ORIGIN",
                 "CORE_DATABASE_URL", "CORE_DATABASE_USER", "CORE_DATABASE_PASSWORD", "CORE_SMTP_HOST", "CORE_SMTP_PORT",
                 "AUTH_PUBLIC_ORIGIN", "AUTH_MAIL_FROM", "AUTH_JWT_SECRET", "AUTH_COOKIE_SECURE",
                 "CONTENT_ENABLED", "CONTENT_DEV_OWNER", "CONTENT_DATABASE_URL", "CONTENT_DATABASE_USER", "CONTENT_DATABASE_PASSWORD", "INTERNAL_TOKEN",
                 "SETTING_ATTACHMENTS_ENABLED", "ATTACHMENT_S3_ENDPOINT", "ATTACHMENT_S3_REGION", "ATTACHMENT_S3_BUCKET",
                 "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_PROFILE"),
    "ai-service": ("OPENAI_API_KEY", "OPENAI_MODEL", "INTERNAL_TOKEN"),
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
    if os.name == "nt" and service in ("web", "core-api"):
        args = ["cmd", "/d", "/c", "pnpm.cmd", "dev"] if service == "web" else ["cmd", "/d", "/c", "gradlew.bat", "bootRun"]
        sys.exit(subprocess.call(args, env=env))
    os.execvpe(args[0], args, env)


if __name__ == "__main__":
    main()
