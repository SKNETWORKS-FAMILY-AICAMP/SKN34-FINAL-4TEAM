"""Content 허용 후보 안에서만 회차·인물 대상을 확정한다."""
import re
from typing import Literal, Protocol

from pydantic import Field

from app.retrieval.content_client import ContentReadError, Scope
from app.retrieval.contracts import Contract, Id, PositiveInt


class Target(Contract):
    target_id: Id
    scope_digest: Id
    episode: PositiveInt
    character_id: Id | None = None
    name: Id | None = None


class SlotRequest(Contract):
    scope: Scope = Field(repr=False, exclude=True)
    text: str = Field(default="", max_length=2000, repr=False)
    ui_target: Target | None = None
    previous_target: Target | None = None


class SlotResult(Contract):
    status: Literal["resolved", "needs_confirmation", "denied", "unavailable", "unsupported"]
    target: Target | None = None
    candidates: tuple[Target, ...] = ()
    missing_slots: tuple[Literal["target"], ...] = ("target",)


class TargetContentPort(Protocol):
    def allowed_targets(self, scope: Scope) -> tuple[Target, ...]:
        """현재 위임·공개·인물 지식·manifest를 재검증한 후보만 반환한다."""
        ...


class SlotResolver:
    def __init__(self, content: TargetContentPort):
        self.content = content

    def resolve(self, request: SlotRequest) -> SlotResult:
        try:
            candidates = self.content.allowed_targets(request.scope)
        except ContentReadError as error:
            return SlotResult(status=error.status)
        except OSError:
            return SlotResult(status="unavailable")
        digest = request.scope.digest()
        if any(t.scope_digest != digest or t.episode > request.scope.basis_episode for t in candidates):
            return SlotResult(status="denied")
        if len({t.target_id for t in candidates}) != len(candidates):
            return SlotResult(status="denied")
        ui, previous = request.ui_target, request.previous_target
        if ui is not None and ui not in candidates:
            return SlotResult(status="denied")
        previous = previous if previous in candidates else None
        selected = ui or previous
        if re.search(r"다른\s*(?:작품|포크|Fork)|작품.*(?:변경|바꿔)|\b(?:work_id|fork_id)\b", request.text, re.I):
            return SlotResult(status="needs_confirmation")
        numbers = re.findall(r"(?<!\d)(\d+)\s*화", request.text)
        if len(numbers) > 1 or re.search(r"\d+\s*[~～\-–]\s*\d+\s*화", request.text):
            return SlotResult(status="needs_confirmation")
        episode = int(numbers[0]) if numbers else None
        if episode is not None and not 1 <= episode <= request.scope.basis_episode:
            return SlotResult(status="denied")
        # 허용된 이름만 경계 일치시킨다. 미등록 이름을 가까운 인물로 교정하지 않는다.
        names = {t.name for t in candidates if t.name and re.search(
            rf"(?<![\w]){re.escape(t.name)}(?:[을를이가은는의]|(?=$|[\s,.!?]))", request.text)}
        command_text = re.sub(r"\d+\s*화(?:의)?", "", request.text).strip()
        named_command = re.match(r"(.+?)\s+(?:검수|검토|수정|시뮬레이션)", command_text)
        if named_command:
            raw_name = named_command[1]
            parsed_name = re.sub(r"[을를이가은는의]$", "", raw_name)
            if raw_name not in names and parsed_name not in names:
                return SlotResult(status="needs_confirmation")
        if len(names) > 1:
            return SlotResult(status="needs_confirmation")
        matches = tuple(t for t in candidates if (episode is None or t.episode == episode)
                        and (not names or t.name in names))
        explicit = episode is not None or bool(names)
        if selected is not None and (not explicit or selected in matches):
            return SlotResult(status="resolved", target=selected, missing_slots=())
        if explicit and selected is None and len(matches) == 1:
            return SlotResult(status="resolved", target=matches[0], missing_slots=())
        return SlotResult(status="needs_confirmation", candidates=matches if explicit else candidates)
