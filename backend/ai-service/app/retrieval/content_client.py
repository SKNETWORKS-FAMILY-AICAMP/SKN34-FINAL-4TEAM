"""Content가 승인한 manifest와 정확한 원문을 읽는 내부 계약."""

from dataclasses import asdict, dataclass, field
from hashlib import sha256
import json
from typing import Literal, Protocol


class ContentReadError(Exception):
    """대상 존재 여부나 원문을 포함하지 않는 읽기 실패."""

    def __init__(self, status: Literal["denied", "unsupported", "unavailable"]):
        self.status = status
        super().__init__(status)


@dataclass(frozen=True)
class Scope:
    grant_ref: str = field(repr=False)
    subject_ref: str
    work_id: str
    fork_id: str | None
    basis_episode: int
    audience: Literal["owner", "reader", "character"]
    character_id: str | None
    purpose: str
    manifest_ref: str
    world_id: str | None = None

    def __post_init__(self):
        refs = [self.grant_ref, self.subject_ref, self.work_id, self.purpose, self.manifest_ref]
        refs.extend(ref for ref in (self.fork_id, self.world_id, self.character_id) if ref is not None)
        if any(not isinstance(ref, str) or not ref.strip() for ref in refs):
            raise ContentReadError("denied")
        if self.fork_id is not None and self.fork_id != self.work_id:
            raise ContentReadError("denied")
        if type(self.basis_episode) is not int or self.basis_episode < 1:
            raise ContentReadError("denied")
        if self.audience not in ("owner", "reader", "character"):
            raise ContentReadError("denied")
        if (self.audience == "character") != (self.character_id is not None):
            raise ContentReadError("denied")

    def digest(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return sha256(payload.encode()).hexdigest()


@dataclass(frozen=True)
class SourceVersion:
    work_id: str
    kind: str
    document_id: str
    revision: str

    def readable(self) -> bool:
        return self.kind in ("manuscript", "draft", "setting", "plot", "conti") and all(
            isinstance(ref, str) and ref.strip() for ref in (self.work_id, self.document_id, self.revision)
        )


@dataclass(frozen=True)
class Manifest:
    manifest_ref: str
    scope_digest: str
    expected_episodes: tuple[int, ...]
    source_versions: tuple[SourceVersion, ...]


Span = tuple[int, int]


@dataclass(frozen=True)
class VerifiedSource:
    version: SourceVersion
    span: Span | None
    text: str = field(repr=False)
    is_mock: bool


class ContentReadPort(Protocol):
    def manifest(self, scope: Scope) -> Manifest:
        """작업에 바인딩된 서비스 자격·위임을 확인한 뒤 허용 목록만 반환한다."""
        ...

    def read(self, scope: Scope, version: SourceVersion, span: Span | None) -> VerifiedSource:
        """Content에서 현재 권한·판본·구간을 한 번에 재검증하고 원문을 반환한다."""
        ...


def _check_span(span: Span | None) -> None:
    if span is None:
        return
    if not isinstance(span, tuple) or len(span) != 2 or any(type(offset) is not int for offset in span):
        raise ContentReadError("denied")
    if not 0 <= span[0] < span[1]:
        raise ContentReadError("denied")


def utf16_quote(text: str, span: Span | None) -> str:
    if span is None:
        return text
    _check_span(span)
    start, end = span
    raw = text.encode("utf-16-le")
    if end > len(raw) // 2:
        raise ContentReadError("denied")
    try:
        return raw[2 * start:2 * end].decode("utf-16-le")
    except UnicodeDecodeError:
        raise ContentReadError("denied") from None


class CanonicalAdapter:
    def __init__(self, content: ContentReadPort):
        self.content = content

    def manifest(self, scope: Scope) -> Manifest:
        if not isinstance(scope, Scope):
            raise ContentReadError("denied")
        try:
            manifest = self.content.manifest(scope)
        except OSError:
            raise ContentReadError("unavailable") from None
        if manifest.manifest_ref != scope.manifest_ref or manifest.scope_digest != scope.digest():
            raise ContentReadError("denied")
        if any(type(n) is not int or not 1 <= n <= scope.basis_episode for n in manifest.expected_episodes):
            raise ContentReadError("denied")
        if any(not version.readable() for version in manifest.source_versions):
            raise ContentReadError("denied")
        return manifest

    def read(self, scope: Scope, version: SourceVersion, span: Span | None = None,
             expected_hash: str | None = None) -> VerifiedSource:
        manifest = self.manifest(scope)
        if version.kind == "relationship":
            # 작품과 독립 Studio world의 인가된 연결 계약은 #109에서 확정한다.
            raise ContentReadError("unsupported")
        if version not in manifest.source_versions:
            raise ContentReadError("denied")
        _check_span(span)
        try:
            result = self.content.read(scope, version, span)
        except OSError:
            raise ContentReadError("unavailable") from None
        if result.version != version or result.span != span:
            raise ContentReadError("denied")
        if span is not None and len(result.text.encode("utf-16-le")) != 2 * (span[1] - span[0]):
            raise ContentReadError("denied")
        if expected_hash is not None and sha256(result.text.encode()).hexdigest() != expected_hash:
            raise ContentReadError("denied")
        return result
