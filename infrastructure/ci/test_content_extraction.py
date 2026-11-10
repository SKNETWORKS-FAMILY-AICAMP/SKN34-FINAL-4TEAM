"""콘텐츠 추출의 소유권·라우팅·이력 계약. stdlib만 사용하며 앱/DB를 실행하지 않는다."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASELINE = json.loads(Path(__file__).with_name("content_extraction_baseline.json").read_text())
FEATURES = ("work", "episode", "episode_version", "publication", "world", "fork", "proposal", "context", "attachment", "content")


class ContentExtractionTest(unittest.TestCase):
    def test_only_content_service_owns_content_runtime_and_tests(self):
        for feature in FEATURES:
            with self.subTest(feature=feature):
                self.assertFalse((ROOT / f"backend/core-api/src/main/kotlin/ai/storyfork/core/{feature}").exists())
                if feature != "content":
                    self.assertTrue((ROOT / f"backend/content-service/src/main/kotlin/ai/storyfork/content/{feature}").is_dir())
        package = ROOT / "backend/content-service/src/main/kotlin/ai/storyfork/content"
        self.assertFalse((package / "content").exists(), "No duplicate content.content compatibility package")
        self.assertTrue((package / "_common/config/ContentPersistenceConfig.kt").exists())
        self.assertFalse((package / "migration").exists(), "Retired JSONB importer is not runtime code")
        member=(package / "work/entity/MemberEntity.kt").read_text()
        self.assertNotIn("passwordHash",member)
        self.assertNotIn("var email",member)
        for service, forbidden in (("core-api", "ai.storyfork.content."), ("content-service", "ai.storyfork.core.")):
            for source in (ROOT / f"backend/{service}/src/main").rglob("*"):
                if source.suffix in {".kt", ".java"}:
                    with self.subTest(source=source.relative_to(ROOT)):
                        self.assertNotIn(forbidden, source.read_text())
        for language, suffix in (("kotlin", ".kt"), ("java", ".java")):
            for feature in FEATURES:
                old = ROOT / f"backend/core-api/src/test/{language}/ai/storyfork/core/{feature}"
                self.assertEqual([], list(old.rglob("*" + suffix)), str(old))
        java = ROOT / "backend/content-service/src/test/java/ai/storyfork/content/world"
        for name in ("WorldStudioPostgresFixture", "WorldStudioFlywayPostgresTest", "WorldStudioHistoryPostgresTest",
                     "WorldStudioMigrationIdentityTest", "WorldStudioMigrationPostgresTest"):
            self.assertTrue((java / f"{name}.java").is_file())
        self.assertFalse((ROOT / "backend/content-service/src/main/resources/db/migration/auth").exists())

    def test_unaffected_sql_bytes_and_fresh_content_locations(self):
        root=ROOT / "backend/content-service/src/main/resources/db/migration"
        self.assertFalse((root / "content").exists())
        files=sorted((p for p in root.glob('*/*.sql') if p.parent.name in {"work","episode","episode_version","publication","world","fork","proposal"}),key=lambda p:int(re.match(r'V(\d+)__',p.name)[1]))
        # plan leaf(V10~V12)는 이 검사 대상 밖이고, work leaf의 V13은 work_restriction(운영 작품 제한), V14는 work_view(작품 검색·랭킹 조회 기록), V15는 샘플 이관의 공개 표시 메타데이터, V17은 회차 댓글(episode_comment), V18은 work_like(작품 좋아요), V19는 work_interest(관심 작품)·content_event_outbox(알림 사건), V20은 reading_record(독서 기록)다.
        # V21 is work soft delete (work leaf); V22 adds episode publication status and V23 episode author notes without changing existing migration bytes.
        versions = [int(re.match(r'V(\d+)__', p.name)[1]) for p in files]
        baseline = [*range(1,10),13,14,15,17,18,19,20,21,22,23]
        self.assertEqual(baseline, versions[:len(baseline)])
        self.assertGreater(len(versions), len(baseline))
        self.assertEqual(len(versions), len(set(versions)))
        created=set()
        for path in files:
            for statement in re.split(r'(?=CREATE TABLE )',path.read_text()):
                table=re.match(r'CREATE TABLE (\w+)',statement)
                if table: created.add(table[1])
                for target in re.findall(r'REFERENCES\s+(\w+)\s*\(',statement):
                    self.assertIn(target,created,f'{path.name}: forward FK {target}')
        self.assertNotIn('content_work',created)
        for relative, digest in BASELINE["sql_sha256"].items():
            if relative.startswith('db/migration/content/'): continue
            target = ROOT / "backend/content-service/src/main/resources" / relative
            with self.subTest(migration=relative):
                self.assertTrue(target.exists())
                self.assertEqual(digest, hashlib.sha256(target.read_bytes()).hexdigest())
                self.assertFalse((ROOT / "backend/core-api/src/main/resources" / relative).exists())
        persistence=(ROOT / 'backend/content-service/src/main/kotlin/ai/storyfork/content/_common/config/ContentPersistenceConfig.kt').read_text()
        self.assertNotIn('javaMigrations',persistence)
        self.assertIn('content_schema_history',persistence)
        self.assertNotIn('classpath:db/migration/content"',persistence)

    def test_all_existing_public_content_mappings_are_preserved(self):
        for relative, mappings in BASELINE["controller_mappings"].items():
            target = ROOT / "backend/content-service/src/main/kotlin/ai/storyfork/content" / relative
            with self.subTest(controller=relative):
                self.assertTrue(target.exists())
                actual = [list(match) for match in re.findall(r'@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\(([^\n]*)\)', target.read_text())]
                expected = list(mappings)
                if relative == 'publication/controller/PublicationController.kt':
                    expected.insert(-1, ['PutMapping', '"/works/{id}/episodes/{number}/visibility"'])
                self.assertEqual(expected, actual)

    def test_public_proxies_select_content_without_exposing_internal_verification(self):
        for relative in ("frontend/nginx.conf", "infrastructure/nginx.dev.conf"):
            source = (ROOT / relative).read_text()
            with self.subTest(proxy=relative):
                self.assertIn("location = /api/v1/works", source)
                self.assertIn("location ^~ /api/v1/works/", source)
                self.assertIn("location = /api/v1/public/works", source)
                self.assertIn("location ^~ /api/v1/public/works/", source)
                self.assertIn("proxy_pass http://content-service:8081;", source)
                self.assertNotIn("location /internal", source)
        vite = (ROOT / "frontend/vite.config.ts").read_text()
        pattern = re.search(r"'([^']*works[^']*)':\s*\{", vite)[1].replace("\\\\", "\\")
        for path in ("/api/v1/works", "/api/v1/works?limit=2", "/api/v1/works/id", "/api/v1/public/works", "/api/v1/public/works/id?x=1"):
            self.assertRegex(path, pattern)
        for path in ("/api/v1/works-extra", "/api/v1/public/works-extra", "/api/v1/auth/csrf", "/internal/v1/auth/verify"):
            self.assertNotRegex(path, pattern)
        self.assertIn("VITE_CONTENT_DEV_PROXY_TARGET || 'http://localhost:8081'", vite)

    def test_core_verification_is_service_authenticated_and_not_a_content_proxy(self):
        root = ROOT / "backend/core-api/src/main/kotlin/ai/storyfork/core/auth"
        source = "\n".join(p.read_text() for p in root.rglob("*.kt"))
        self.assertIn('/internal/v1/auth/verify', source)
        self.assertIn('X-Content-Service-Token', source)
        self.assertIn('CONTENT_CORE_AUTH_TOKEN', source)
        self.assertIn('MessageDigest.isEqual', source)
        example = (ROOT / '.env.example').read_text()
        self.assertRegex(example, r'(?m)^CONTENT_CORE_AUTH_TOKEN=$')

    def test_content_changes_select_hosted_integration_and_consumers(self):
        spec = importlib.util.spec_from_file_location("ci", ROOT / "infrastructure/ci/ci.py")
        ci = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ci)
        for feature in FEATURES:
            plan = ci.select([f"backend/content-service/src/main/kotlin/ai/storyfork/content/{feature}/Service.kt"])
            with self.subTest(feature=feature):
                self.assertIn("content", {r["service"] for r in plan["integration"]})
                self.assertIn("web", {r["service"] for r in plan["unit"]})
                self.assertIn("content", plan["system"])
        self.assertIn("content", {r["service"] for r in ci.select(["backend/core-api/src/main/kotlin/ai/storyfork/core/auth/config/AuthSecurityConfig.kt"])["integration"]})

    def test_worldstudio_has_no_auth_scan_and_migrates_its_own_schema_on_startup(self):
        source = (ROOT / 'backend/content-service/src/main/kotlin/ai/storyfork/content/world/WorldStudioConfig.kt').read_text()
        self.assertIn('worldStudioEntityManagerFactory', source)
        self.assertIn('worldStudioTransactionManager', source)
        self.assertNotIn('auth.entity', source)
        self.assertIn('.table("world_studio_schema_history")', source)
        self.assertIn('.baselineOnMigrate(false)', source)
        self.assertIn('"validate"', source)

    def test_content_image_and_runtime_are_connected(self):
        for relative in ('infrastructure/docker-compose.yaml', 'infrastructure/docker-compose.local.yaml', 'infrastructure/docker-compose.prod.yaml', 'infrastructure/docker-compose.dev.yaml', 'infrastructure/ci/compose.test.yaml'):
            with self.subTest(compose=relative):
                self.assertIn('  content-service:', (ROOT / relative).read_text())
        self.assertTrue((ROOT / 'backend/content-service/Dockerfile').exists())
        self.assertIn('storyfork-content-service', (ROOT / '.github/workflows/publish-images.yml').read_text())


if __name__ == '__main__':
    unittest.main()
