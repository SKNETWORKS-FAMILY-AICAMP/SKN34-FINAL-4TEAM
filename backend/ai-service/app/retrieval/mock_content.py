"""합성 데이터 전용 Content 읽기 대역. 서버 실행 경로에 등록하지 않는다."""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .content_client import ContentReadError, Manifest, Scope, SourceVersion, Span, VerifiedSource, utf16_quote


@dataclass(frozen=True)
class MockRow:
    version: SourceVersion
    text: str = field(repr=False)
    episode: int
    public: bool = False
    known_by: tuple[str, ...] = ()
    visible_to: int | None = None


@dataclass
class MockContentReadPort:
    """scope와 판본 목록은 테스트의 Content 발급자가 작업별로 주입한다."""

    scope: Scope
    rows: tuple[MockRow, ...]
    expected_episodes: tuple[int, ...]
    pinned: frozenset[SourceVersion]
    inherited: frozenset[SourceVersion]
    expires_at: datetime
    active: bool = True

    def _authorized_rows(self, scope: Scope) -> tuple[MockRow, ...]:
        if not self.active or self.scope != scope or datetime.now(timezone.utc) >= self.expires_at:
            raise ContentReadError("denied")
        allowed = []
        for row in self.rows:
            version = row.version
            if version not in self.pinned or not version.readable():
                continue
            if version.work_id != scope.work_id:
                if scope.fork_id is None or version not in self.inherited or not row.public or version.kind == "draft":
                    continue
            if row.episode not in self.expected_episodes or not 1 <= row.episode <= scope.basis_episode:
                continue
            if row.visible_to is not None and scope.basis_episode > row.visible_to:
                continue
            if scope.audience != "owner" and (not row.public or version.kind == "draft"):
                continue
            if scope.audience == "character" and scope.character_id not in row.known_by and "*" not in row.known_by:
                continue
            allowed.append(row)
        return tuple(allowed)

    def manifest(self, scope: Scope) -> Manifest:
        rows = self._authorized_rows(scope)
        return Manifest(scope.manifest_ref, scope.digest(), self.expected_episodes,
                        tuple(row.version for row in rows))

    def read(self, scope: Scope, version: SourceVersion, span: Span | None) -> VerifiedSource:
        for row in self._authorized_rows(scope):
            if row.version == version:
                return VerifiedSource(version, span, utf16_quote(row.text, span), is_mock=True)
        raise ContentReadError("denied")
