"""Focused native-launcher checks; never reads the developer's .env."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("run_native", Path(__file__).with_name("run-native.py"))
assert spec is not None and spec.loader is not None
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class NativeLauncherTest(unittest.TestCase):
    def test_service_boundaries(self):
        values = {key: "fixture" for keys in launcher.SETTINGS.values() for key in keys}
        with patch.dict(os.environ, values):
            for service, allowed in launcher.SETTINGS.items():
                env = launcher.service_environment(service, values)
                for key in values:
                    self.assertEqual(key in env, key in allowed)

    def test_real_dotenv_parser_and_exec_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text('OPENAI_API_KEY="fixture only"\nAI_SERVICE_READ_TIMEOUT=3s\nVITE_CORE_API_BASE_URL=http://localhost:9999\n')
            for service, (folder, command) in launcher.COMMANDS.items():
                (root / folder).mkdir(parents=True, exist_ok=True)
                with patch.object(launcher, "ROOT", root), patch.object(launcher.sys, "argv", ["run-native.py", service]), patch.object(launcher.os, "chdir"), patch.object(launcher.os, "execvpe") as execute:
                    launcher.main()
                    args = execute.call_args.args
                    self.assertEqual(args[1], command)
                    env = args[2]
                    self.assertEqual("OPENAI_API_KEY" in env, service == "ai-service")
                    if service == "core-api":
                        self.assertEqual(env["AI_SERVICE_READ_TIMEOUT"], "3s")
                    if service == "web":
                        self.assertEqual(env["VITE_CORE_API_BASE_URL"], "http://localhost:9999")

    def test_missing_uv_is_safe_error(self):
        with patch.object(launcher.sys, "argv", ["run-native.py", "web"]), patch.object(launcher.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(SystemExit, "uv"):
                launcher.main()


if __name__ == "__main__":
    unittest.main()
