"""CI 이미지 빌드가 외부 저장소 대신 우리가 보관한 Gradle 배포판·빌드용 이미지를 쓰는지 정적으로 검사한다."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = "ghcr.io/sknetworks-family-aicamp/"
GRADLE_RELEASE = ("https\\://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/releases/download/"
                  "tools-gradle-9.5.1/gradle-9.5.1-bin.zip")
# 서비스 Dockerfile → 그 builder 단계가 쓰는 빌드용 이미지
SERVICE_BUILDERS = {
    "backend/core-api": "jvm",
    "backend/content-service": "jvm",
    "backend/operations-service": "jvm",
    "backend/ai-service": "python",
    "frontend": "web",
}


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class BuilderImagesTest(unittest.TestCase):
    def test_gradle_wrapper_downloads_our_release_copy_with_checksum(self):
        for service in ("core-api", "content-service", "operations-service"):
            with self.subTest(service=service):
                props = read(f"backend/{service}/gradle/wrapper/gradle-wrapper.properties")
                self.assertIn("distributionUrl=" + GRADLE_RELEASE + "\n", props)
                self.assertIn("distributionSha256Sum=bafc141b619ad6350fd975fc903156dd5c151998cc8b058e8c1044ab5f7b031f", props)
                self.assertNotIn("services.gradle.org", props)

    def test_service_builds_start_from_prebuilt_dependency_images(self):
        for context, builder in SERVICE_BUILDERS.items():
            with self.subTest(context=context):
                dockerfile = read(f"{context}/Dockerfile")
                self.assertIn(f"FROM {REGISTRY}storyfork-{builder}-builder:latest AS builder\n", dockerfile)
                # 캐시 마운트는 이미지에 미리 받아 둔 의존성 디렉터리를 가린다.
                self.assertNotIn("--mount=type=cache", dockerfile)

    def test_builder_images_warm_each_dependency_source(self):
        jvm = read("infrastructure/builders/jvm.Dockerfile")
        for service in ("core-api", "content-service", "operations-service"):
            self.assertIn(f"backend/{service}/build.gradle", jvm)
        self.assertIn("./gradlew dependencies --no-daemon", jvm)
        python = read("infrastructure/builders/python.Dockerfile")
        self.assertIn("backend/ai-service/uv.lock", python)
        self.assertIn("uv sync --locked --no-dev --no-install-project", python)
        web = read("infrastructure/builders/web.Dockerfile")
        self.assertIn("frontend/pnpm-lock.yaml", web)
        self.assertIn("pnpm fetch", web)

    def test_builder_workflow_rebuilds_on_dependency_changes_and_pushes_all_images(self):
        workflow = read(".github/workflows/builder-images.yml")
        for path in ("backend/*/build.gradle", "backend/*/gradle/wrapper/gradle-wrapper.properties",
                     "backend/ai-service/uv.lock", "frontend/pnpm-lock.yaml", "infrastructure/builders/**"):
            self.assertIn(f"- '{path}'", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("packages: write", workflow)
        self.assertIn("for builder in jvm python web; do", workflow)
        self.assertIn(f'image="{REGISTRY}storyfork-$builder-builder:latest"', workflow)


if __name__ == "__main__":
    unittest.main()
