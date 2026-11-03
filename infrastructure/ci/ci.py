"""보수적인 변경 범위 선택·결과 집계·로그 정제. 테스트는 CI가 표준 도구로 직접 실행한다."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SERVICES = ("web", "core", "ai")
SCENARIOS = ["health", "auth", "content", "ai"]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip("\n")


def comparison_base(event, payload):
    if event == "workflow_dispatch":
        return None  # 수동 실행은 명시적으로 모든 범위를 검증한다.
    sha = payload.get("pull_request", {}).get("base", {}).get("sha") if event == "pull_request" else payload.get("before")
    if not sha or not re.fullmatch(r"[0-9a-f]{40}", sha) or sha == "0" * 40:
        return None
    try:
        if event == "pull_request":
            return git("merge-base", sha, "HEAD")
        git("cat-file", "-e", sha + "^{commit}")
        return sha
    except subprocess.CalledProcessError:
        return None  # 새 브랜치·force push 등 기준선 부재는 전체 검증으로 fail-safe.


def changed_paths(base):
    return git("diff", "--name-only", "--no-renames", "-z", base, "HEAD").split("\0")[:-1]


def select(paths, full=False):
    scopes = {service: set() for service in SERVICES}
    scenarios = set()
    infra = full

    def core(*features):
        scopes["core"].update(features)

    for path in paths:
        if path.endswith(".md") or path.startswith(("docs/", "graphify-out/")) or path in {"LICENSE", ".gitignore", ".graphifyrc"}:
            continue
        if path.startswith("frontend/"):
            scopes["web"].add("all")
            if not (".test." in path or path.startswith("frontend/src/test")):
                scenarios.update(SCENARIOS)
            infra |= path.endswith(("nginx.conf", "Dockerfile", "Dockerfile.dev"))
        elif path.startswith("backend/core-api/"):
            feature = next((name for name in ("auth", "content", "_health", "_health_ai_service") if f"/core/{name}/" in path or f"/db/migration/{name}/" in path), None)
            if "/db/content/" in path:
                feature = "content"
            if "/config/" in path or path.endswith(("Config.kt", "Properties.kt")):
                feature = None  # Bean/security 설정은 기능 경계를 넘어 Core 전체를 검증한다.
            features = {"auth": ("auth",), "content": ("content", "health"), "_health": ("health",), "_health_ai_service": ("health",)}.get(feature, ("all",))
            core(*(("content",) if feature == "content" and "/src/test/" in path else features))
            if "/src/test/" not in path:
                scopes["web"].add("all")  # 공개 API의 현재 소비자. 개별 DTO 영향까지 추측하지 않는다.
                scenarios.add("health")
                if feature == "auth":
                    core("content")
                    scenarios.update(("auth", "content"))
                elif feature == "content":
                    scopes["ai"].add("all")
                    scenarios.update(("content", "ai"))
                elif feature is None:
                    scenarios.update(SCENARIOS)
                if feature in {None, "_health_ai_service"}:
                    scopes["ai"].add("all")
            infra |= "Dockerfile" in path
        elif path.startswith("backend/ai-service/"):
            scopes["ai"].add("all")
            if "/tests/" not in path:
                core("content", "health")
                scopes["web"].add("all")
                scenarios.update(("health", "ai"))
            infra |= "Dockerfile" in path
        else:
            # ponytail: 모르는 실행 경로/공유 설정은 전체 서비스; 정밀 분석기는 필요할 때만.
            full = True
            infra = True
    if full:
        for scope in scopes.values():
            scope.add("all")
        scenarios.update(SCENARIOS)
    rows = [{"service": service, "scope": "all" if "all" in scope else ",".join(sorted(scope))}
            for service, scope in scopes.items() if scope]
    return {"unit": rows, "integration": rows.copy(), "system": [s for s in SCENARIOS if s in scenarios], "infra": infra}


def check_results(results, expected):
    if expected - results.keys():
        raise SystemExit("Required CI: missing required job results")
    for job, result in results.items():
        if result not in {"success", "skipped"} or (job in expected and result != "success"):
            raise SystemExit(f"Required CI: {job} ended as {result}")


def redact(text):
    for key in ("AUTH_JWT_SECRET", "INTERNAL_TOKEN", "CORE_DATABASE_PASSWORD", "OPENAI_API_KEY"):
        value = os.environ.get(key, "")
        if value:
            text = text.replace(value, "[redacted]")
    text = re.sub(r"[\w.+-]+@[\w.-]+", "[email]", text)
    # Bearer/JWT/fragment・hex・base64 토큰과 synthetic 사용자 식별자도 보관하지 않는다.
    text = re.sub(r"(?i)(bearer\s+|#token=)[^\s<\"']+", r"\1[redacted]", text)
    return re.sub(r"[A-Za-z0-9_+/=-]{32,}(?:\.[A-Za-z0-9_+/=-]+)*", "[redacted]", text)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("plan")
    reports = sub.add_parser("reports")
    reports.add_argument("output")
    reports.add_argument("paths", nargs="+")
    sub.add_parser("required")
    args = parser.parse_args()
    if args.action == "plan":
        payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        base = comparison_base(os.environ["GITHUB_EVENT_NAME"], payload)
        plan = select(changed_paths(base) if base else [], full=base is None)
        print(json.dumps({"base": base, **plan}, indent=2))
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            for tier in ("unit", "integration"):
                output.write(f"{tier}={json.dumps({'include': plan[tier]})}\n{tier}_needed={str(bool(plan[tier])).lower()}\n")
            output.write(f"system={','.join(plan['system'])}\nsystem_needed={str(bool(plan['system'])).lower()}\ninfra={str(plan['infra']).lower()}\n")
        git("diff", "--check", base or git("hash-object", "-t", "tree", "/dev/null"), "HEAD")
    elif args.action == "reports":
        out = Path(args.output)
        out.mkdir(parents=True, exist_ok=True)
        for index, source in enumerate(args.paths):
            source = Path(source)
            files = source.rglob("*") if source.is_dir() else [source]
            for file in files:
                if file.is_file() and file.suffix in {".xml", ".txt", ".log", ".json"}:
                    target = out / str(index) / (file.relative_to(source) if source.is_dir() else file.name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(redact(file.read_text(errors="replace")))
    elif args.action == "required":
        expected = {tier for tier in ("unit", "integration", "system", "configuration") if os.environ[tier.upper() + "_NEEDED"] == "true"}
        expected.add("changes")
        check_results({job: value["result"] for job, value in json.loads(os.environ["NEEDS"]).items()}, expected)


if __name__ == "__main__":
    main()
