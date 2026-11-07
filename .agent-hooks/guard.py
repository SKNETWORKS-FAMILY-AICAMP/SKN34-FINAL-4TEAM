#!/usr/bin/env python3
"""STORYFORK 공통 에이전트 훅 (Claude Code · Codex · Hermes).

사용: guard.py <claude|codex|hermes>  — stdin으로 각 도구의 훅 JSON을 받는다.
- 세션 시작: ponytail·graphify 권장 문맥 주입
- 도구 실행 전: Git workflow 강제, graphify 설치 시 첫 검색을 graphify로 유도
- 작업 종료: 코드 변경마다 한 번 TDD·아키텍처·단위 테스트·리뷰 점검 지시
STORYFORK 저장소(.agent-hooks/guard.py가 있는 git 루트) 밖에서는 아무것도 하지 않는다.
"""
import hashlib
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

TYPES = "feat|fix|docs|refactor|test|style|perf|build|ci|chore|revert"
BRANCH_RE = re.compile(rf"^({TYPES})/[a-z0-9]+(-[a-z0-9]+)*$")
COMMIT_RE = re.compile(rf"^({TYPES})(\([^)]+\))?!?: .*[가-힣]")
PROTECTED = {"main", "develop"}
SEARCH_TOOLS = {"Grep", "Glob", "search_files"}
SEARCH_CMDS = {"rg", "grep", "egrep", "find", "ag", "fd"}


def git(root, *args):
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True,
                       stdin=subprocess.DEVNULL, timeout=10)
    return r.stdout.rstrip("\n") if r.returncode == 0 else ""  # porcelain 앞 공백 보존


def repo_root(cwd):
    top = git(cwd or ".", "rev-parse", "--show-toplevel")
    return Path(top) if top and (Path(top) / ".agent-hooks" / "guard.py").exists() else None


def state_file(root, name):
    d = Path(root, git(root, "rev-parse", "--git-dir"), "agent-hooks")
    d.mkdir(parents=True, exist_ok=True)
    return d / re.sub(r"[^A-Za-z0-9_.-]", "_", name)


def graphify_ready(root):
    return bool(shutil.which("graphify")) and (root / "graphify-out" / "graph.json").exists()


def segments(cmd):
    # 따옴표 밖 줄바꿈도 명령 구분자다. ponytail: 따옴표 없는 heredoc 본문도 명령으로 보지만 오탐만 생긴다.
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    try:
        tokens = list(lex)
    except ValueError:
        return []
    seg = []
    for t in tokens:
        if t and set(t) <= set(";&|\n"):
            yield seg
            seg = []
        else:
            seg.append(t)
    yield seg


def git_args(seg):
    """`[ENV=..] git [-C x|-c k=v] <sub> ...` → [sub, ...] 또는 None."""
    while seg and re.match(r"^\w+=", seg[0]):
        seg = seg[1:]
    if not seg or Path(seg[0]).name != "git":
        return None
    rest = seg[1:]
    while rest and rest[0] in {"-C", "-c"}:
        rest = rest[2:]
    return rest or None


def option_value(args, short, long):
    for i, a in enumerate(args):
        if a in (short, long) and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(long + "="):
            return a.split("=", 1)[1]
        if a.startswith("-") and not a.startswith("--") and short[1] in a[1:]:
            tail = a[a.index(short[1]) + 1:]  # -am "msg" / -mmsg
            return tail or (args[i + 1] if i + 1 < len(args) else None)
    return None


def commit_message(args, root):
    msg = option_value(args, "-m", "--message")
    if msg is None:
        path = option_value(args, "-F", "--file")
        if path is None:
            return None
        try:
            msg = Path(root, path).read_text()
        except OSError:
            return None
    if msg.startswith("$("):  # "$(cat <<'EOF' ... EOF)" heredoc
        lines = msg.splitlines()
        idx = next((i for i, line in enumerate(lines) if "<<" in line), None)
        msg = "\n".join(lines[idx + 1:]) if idx is not None else ""
    return msg.strip().splitlines()[0] if msg.strip() else ""


def check_git(cmd, root):
    """Git workflow 위반 시 ("block"|"ask", 사유)."""
    for seg in segments(cmd):
        if seg[:3] == ["gh", "pr", "merge"]:
            return "ask", "PR 병합은 임의로 하지 않는다. 사용자 확인이 필요하다."
        args = git_args(seg)
        if not args:
            continue
        sub, rest = args[0], args[1:]
        positional = [a for a in rest if not a.startswith("-")]
        if sub == "push":
            current = git(root, "branch", "--show-current")
            dests = [p.split(":")[-1].lstrip("+").removeprefix("refs/heads/") for p in positional[1:]]
            dests = [current if d == "HEAD" else d for d in dests] or [current]
            hit = PROTECTED.intersection(dests)
            if hit:
                return "ask", f"{'/'.join(sorted(hit))} 직접 푸시는 사용자 확인이 필요하다. 기본은 작업 브랜치 → PR."
        elif sub in {"switch", "checkout", "branch"}:
            flags = {"switch": {"-c", "-C", "--create"}, "checkout": {"-b", "-B"}}.get(sub)
            if flags is not None:
                name = next((rest[i + 1] for i, a in enumerate(rest[:-1]) if a in flags), None)
            else:
                name = rest[0] if rest and not rest[0].startswith("-") else None
            if name and not BRANCH_RE.match(name):
                return "block", f"브랜치 이름 '{name}'은 `<type>/<영문-소문자-설명>` 형식이어야 한다 (type: {TYPES})."
        elif sub == "commit":
            first = commit_message(rest, root)
            if first is not None and not COMMIT_RE.match(first):
                return "block", f"커밋 메시지 '{first}'는 `<type>: <한국어 설명>` 형식이어야 한다 (type: {TYPES})."
        elif sub == "add":
            # 디렉터리·-A·-f로 실제 추가될 경로까지 본다(dry-run 출력: add 'path').
            staged = re.findall(r"^add '(.+)'$", git(root, "add", "--dry-run", *rest), re.M)
            for p in positional + staged:
                name = Path(p).name
                if (name == ".env" or name.startswith(".env.")) and name != ".env.example":
                    return "block", f"{p}: 실제 .env는 커밋하지 않는다. 공유는 .env.example만."
    return None


def check_graphify(tool_name, cmd, payload, root):
    if not graphify_ready(root):
        return None
    marker = state_file(root, f"graphify-{payload.get('session_id') or 'default'}")
    firsts = {Path(s[0]).name for s in segments(cmd) if s}
    if "graphify" in firsts or marker.exists():
        marker.touch()
        return None
    if tool_name in SEARCH_TOOLS or firsts & SEARCH_CMDS:
        marker.touch()  # 한 번만 유도한다
        return "토큰 절약: 코드 탐색은 먼저 `graphify query \"<질문>\"`/`explain`/`path`로 범위를 좁힌 뒤 검색한다."
    return None


def is_doc(p):
    return p.endswith(".md") or p.startswith(("docs/", "graphify-out/"))


def is_test(p):
    return bool(re.search(r"(^|/)(tests?|__tests__)/|(^|/)test_[^/]*$|[._-]test\.|Tests?\.kt$|_test\.py$", p))


def check_stop(root, retry):
    paths = [line[3:].split(" -> ")[-1] for line in git(root, "status", "--porcelain", "-uall").splitlines()]
    code = [p for p in paths if not is_doc(p)]
    if not code:
        return None
    if graphify_ready(root):  # LLM 없는 AST 갱신. 출력은 문맥에 넣지 않는다.
        subprocess.Popen(["graphify", "update", "."], cwd=root, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    fp = hashlib.sha256((git(root, "diff", "HEAD") + "\n".join(sorted(paths))).encode()).hexdigest()
    marker = state_file(root, "verified")
    seen = marker.read_text() if marker.exists() else ""
    marker.write_text(fp)
    if retry or fp == seen:
        return None
    steps = []
    if not any(is_test(p) for p in code):
        steps.append("TDD: 운영 코드만 바뀌었다. 로직 변경이면 실패하는 단위 테스트를 추가한다(화면 연결·설정만이면 사유를 적는다).")
    steps.append("변경 범위의 단위 테스트만 실행한다. 통합·시스템·브라우저 검증은 CI 또는 사용자 요청 시에만.")
    steps.append("아키텍처·설계 문서(docs/design, 서비스 AGENTS.md)대로인지 점검하고"
                 + (" 달라진 부분은 docs를 보완한다." if not any(p.startswith("docs/") for p in paths) else " docs 보완을 확인한다."))
    rec = ["ponytail-review"] + (["code-review(CodeRabbit)"] if shutil.which("coderabbit") else [])
    steps.append(f"권장: {', '.join(rec)}로 이번 변경분만 리뷰하고 유효한 지적만 반영한다.")
    return "작업 종료 전 1회 점검:\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))


def session_context(root):
    lines = ["[STORYFORK] 구현은 ponytail full(.agents/skills/ponytail) 적용을 권장한다."]
    if graphify_ready(root):
        lines.append("코드 탐색은 grep·파일 전체 읽기 전에 `graphify query/explain/path`부터 사용한다.")
    return "\n".join(lines)


def main():
    tool = sys.argv[1] if len(sys.argv) > 1 else "claude"
    payload = json.load(sys.stdin)
    root = repo_root(payload.get("cwd"))
    if root is None:
        return 0
    event = payload.get("hook_event_name", "")
    extra = payload.get("extra") or {}

    if event in {"SessionStart", "pre_llm_call"}:
        if event == "pre_llm_call" and not extra.get("is_first_turn"):
            return 0
        ctx = session_context(root)
        out = {"context": ctx} if tool == "hermes" else \
            {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ctx}}
        print(json.dumps(out, ensure_ascii=False))
    elif event in {"PreToolUse", "pre_tool_call"}:
        tool_input = payload.get("tool_input") or {}
        cmd = tool_input.get("command") or "" if isinstance(tool_input, dict) else ""
        cmd = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        found = check_git(cmd, root)
        if found is None:
            reason = check_graphify(payload.get("tool_name", ""), cmd, payload, root)
            found = ("block", reason) if reason else None
        if found:
            kind, reason = found
            if kind == "ask" and tool == "claude":
                print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                                         "permissionDecisionReason": reason}}, ensure_ascii=False))
            elif kind == "ask" and tool == "hermes":
                print(json.dumps({"action": "approve", "message": reason}, ensure_ascii=False))
            else:  # 차단 · Codex는 ask 미지원이라 차단
                print(reason, file=sys.stderr)
                return 2
    elif event in {"Stop", "pre_verify"}:
        retry = bool(payload.get("stop_hook_active")) or int(extra.get("attempt") or 0) > 0
        reason = check_stop(root, retry)
        if reason:
            print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
