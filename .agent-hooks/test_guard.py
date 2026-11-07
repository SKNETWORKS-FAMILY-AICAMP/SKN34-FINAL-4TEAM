"""guard.py 훅 회귀 테스트(stdlib). 실행: python3 -m unittest discover -s .agent-hooks -v"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

GUARD = Path(__file__).with_name("guard.py")


def sh(cwd, *args):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        sh(self.repo, "git", "init", "-q", "-b", "feat/base")
        sh(self.repo, "git", "config", "user.email", "t@t")
        sh(self.repo, "git", "config", "user.name", "t")
        (self.repo / ".agent-hooks").mkdir()
        (self.repo / ".agent-hooks" / "guard.py").write_text("")
        (self.repo / "app.py").write_text("x = 1\n")
        sh(self.repo, "git", "add", ".")
        sh(self.repo, "git", "commit", "-qm", "init")
        self.env = {**os.environ, "PATH": "/usr/bin:/bin"}  # graphify 없음이 기본

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, tool, payload, cwd=None):
        payload = {"cwd": str(cwd or self.repo), "session_id": "s1", **payload}
        r = subprocess.run(["python3", str(GUARD), tool], input=json.dumps(payload),
                           capture_output=True, text=True, env=self.env)
        return r.returncode, r.stdout.strip(), r.stderr.strip()

    def bash(self, tool, command):
        event = "pre_tool_call" if tool == "hermes" else "PreToolUse"
        name = "terminal" if tool == "hermes" else "Bash"
        return self.run_hook(tool, {"hook_event_name": event, "tool_name": name,
                                    "tool_input": {"command": command}})

    def stop(self, tool="claude", **extra):
        if tool == "hermes":
            return self.run_hook(tool, {"hook_event_name": "pre_verify", "extra": {"attempt": 0, **extra}})
        return self.run_hook(tool, {"hook_event_name": "Stop", **extra})

    # --- Git workflow ---
    def test_push_to_develop_asks_user_per_tool(self):
        code, out, _ = self.bash("claude", "git push origin develop")
        self.assertEqual(0, code)
        self.assertEqual("ask", json.loads(out)["hookSpecificOutput"]["permissionDecision"])
        code, _, err = self.bash("codex", "git push origin HEAD:develop")
        self.assertEqual(2, code)  # Codex는 ask 미지원 → 차단
        self.assertIn("develop", err)
        code, out, _ = self.bash("hermes", "git push origin main")
        self.assertEqual("approve", json.loads(out)["action"])

    def test_bare_push_on_develop_branch_asks(self):
        sh(self.repo, "git", "switch", "-qc", "develop")
        _, out, _ = self.bash("claude", "git push")
        self.assertEqual("ask", json.loads(out)["hookSpecificOutput"]["permissionDecision"])

    def test_push_feature_branch_and_pr_merge(self):
        self.assertEqual((0, "", ""), self.bash("claude", "git push -u origin feat/base"))
        _, out, _ = self.bash("claude", "cd x && gh pr merge 12 --squash")
        self.assertEqual("ask", json.loads(out)["hookSpecificOutput"]["permissionDecision"])

    def test_branch_name_format(self):
        self.assertEqual(2, self.bash("claude", "git switch -c myBranch")[0])
        self.assertEqual(2, self.bash("hermes", "git checkout -b feature/Login")[0])
        self.assertEqual((0, "", ""), self.bash("claude", "git switch -c feat/42-work-registration"))
        self.assertEqual((0, "", ""), self.bash("claude", "git branch -d old"))

    def test_commit_message_format(self):
        self.assertEqual(2, self.bash("claude", 'git commit -m "feat: add login"')[0])
        self.assertEqual(2, self.bash("codex", 'git add -u && git commit -m "로그인 추가"')[0])
        self.assertEqual((0, "", ""), self.bash("claude", 'git commit -m "feat: 로그인 추가"'))
        heredoc = "git commit -m \"$(cat <<'EOF'\nfix(core): 중복 요청 수정\n\n본문\nEOF\n)\""
        self.assertEqual((0, "", ""), self.bash("claude", heredoc))
        (self.repo / "msg.txt").write_text("update stuff\n")
        self.assertEqual(2, self.bash("hermes", "git commit -F msg.txt")[0])
        self.assertEqual((0, "", ""), self.bash("claude", "git commit --amend --no-edit"))

    def test_env_file_cannot_be_staged(self):
        self.assertEqual(2, self.bash("claude", "git add -f .env")[0])
        self.assertEqual(2, self.bash("hermes", "git add backend/.env.local")[0])
        self.assertEqual((0, "", ""), self.bash("claude", "git add .env.example"))

    def test_outside_storyfork_is_noop(self):
        with tempfile.TemporaryDirectory() as other:
            sh(other, "git", "init", "-q")
            code, out, _ = self.run_hook("hermes", {"hook_event_name": "pre_tool_call", "tool_name": "terminal",
                                                    "tool_input": {"command": "git push origin main"}}, cwd=other)
            self.assertEqual((0, ""), (code, out))

    # --- 작업 종료 검증 루프 ---
    def test_stop_requires_verification_once_per_change(self):
        (self.repo / "app.py").write_text("x = 2\n")
        _, out, _ = self.stop()
        reason = json.loads(out)
        self.assertEqual("block", reason["decision"])
        self.assertIn("TDD", reason["reason"])
        self.assertIn("ponytail-review", reason["reason"])
        (self.repo / "app.py").write_text("x = 3\n")  # 검증 중 수정
        self.assertEqual("", self.stop(stop_hook_active=True)[1])  # 루프 1회 제한
        self.assertEqual("", self.stop()[1])  # 같은 변경은 다시 막지 않음

    def test_stop_without_tdd_warning_when_tests_changed(self):
        (self.repo / "app.py").write_text("x = 2\n")
        (self.repo / "test_app.py").write_text("")
        reason = json.loads(self.stop("codex")[1])["reason"]
        self.assertNotIn("TDD", reason)

    def test_stop_ignores_docs_only_and_hermes_retry(self):
        (self.repo / "README.md").write_text("doc\n")
        self.assertEqual("", self.stop()[1])
        (self.repo / "app.py").write_text("x = 2\n")
        self.assertEqual("block", json.loads(self.stop("hermes")[1])["decision"])
        (self.repo / "app.py").write_text("x = 3\n")
        self.assertEqual("", self.stop("hermes", attempt=1)[1])  # Hermes 재시도는 통과

    # --- 세션 시작 문맥 · graphify ---
    def fake_graphify(self):
        bin_dir = self.repo / "bin"
        bin_dir.mkdir()
        exe = bin_dir / "graphify"
        exe.write_text("#!/bin/sh\nexit 0\n")
        exe.chmod(0o755)
        (self.repo / "graphify-out").mkdir()
        (self.repo / "graphify-out" / "graph.json").write_text("{}")
        self.env["PATH"] = f"{bin_dir}:{self.env['PATH']}"

    def test_session_context_per_tool(self):
        _, out, _ = self.run_hook("claude", {"hook_event_name": "SessionStart"})
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("ponytail", ctx)
        self.assertNotIn("graphify", ctx)
        self.fake_graphify()
        _, out, _ = self.run_hook("hermes", {"hook_event_name": "pre_llm_call", "extra": {"is_first_turn": True}})
        self.assertIn("graphify query", json.loads(out)["context"])
        self.assertEqual("", self.run_hook("hermes", {"hook_event_name": "pre_llm_call",
                                                     "extra": {"is_first_turn": False}})[1])

    def test_first_search_redirects_to_graphify_once(self):
        self.assertEqual((0, "", ""), self.bash("claude", "rg Fork backend"))  # graphify 없으면 통과
        self.fake_graphify()
        code, _, err = self.run_hook("claude", {"hook_event_name": "PreToolUse", "tool_name": "Grep",
                                                "tool_input": {"pattern": "Fork"}})
        self.assertEqual(2, code)
        self.assertIn("graphify", err)
        self.assertEqual((0, "", ""), self.bash("claude", "rg Fork backend"))

    def test_graphify_use_satisfies_search_gate(self):
        self.fake_graphify()
        self.assertEqual((0, "", ""), self.bash("hermes", 'graphify query "Fork 흐름"'))
        self.assertEqual((0, "", ""), self.bash("hermes", "grep -rn Fork ."))


if __name__ == "__main__":
    unittest.main()
