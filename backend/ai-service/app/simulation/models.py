"""인물 시뮬레이션 계약(docs/design/character-simulation-contract.md): 계획·턴·검사·결과 DTO와 모델 출력 형식.

결과 DTO(`SimulationResult`)는 계약 JSON 모양 그대로이며 오케스트레이션 단계 결과와 턴마다의 step 이벤트가 같은 모양을 쓴다.
모델 출력 DTO(`PlanDraft`·`Action`·`Verdict`)는 Structured Outputs 스키마라 길이·개수 제약을 두지 않고, 한도는 service가 다시 검증한다.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal['if', 'flow']
CheckKind = Literal['knowledge_leak', 'voice_mix', 'relation', 'premise', 'beat']
Gap = Literal['mode', 'premise', 'beats', 'characterIds']
# 작가에게 되묻는 문구에 쓰는 고정 라벨(모델이 쓴 문장은 쓰지 않는다).
GAP_LABELS = {'mode': '모드(IF·흐름)', 'premise': 'IF 전제', 'beats': '장면 비트', 'characterIds': '참여 인물'}


class SimulationPlan(BaseModel):
    """모드·전제·비트·참여 인물. 메인 에이전트가 요청 문장에서 뽑거나 작가가 resume으로 채운다. 비어 있는 값은 gaps()다."""
    model_config = ConfigDict(extra='forbid')
    mode: Mode | None = None
    premise: str | None = Field(default=None, min_length=1, max_length=500)
    beats: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default=[], max_length=8)
    characterIds: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default=[], max_length=6)

    def gaps(self) -> list[Gap]:
        """실행 전에 작가가 더 알려 줘야 하는 것. IF는 전제 하나, 흐름은 비트 목록이 필요하다."""
        gaps: list[Gap] = []
        if self.mode is None:
            gaps.append('mode')
        elif self.mode == 'if' and not self.premise:
            gaps.append('premise')
        elif self.mode == 'flow' and not self.beats:
            gaps.append('beats')
        if not self.characterIds:
            gaps.append('characterIds')
        return gaps

    def merged(self, answer: 'SimulationPlan') -> 'SimulationPlan':
        """작가의 답에서 값이 있는 필드만 덮어쓴다. 비어 있는 필드가 이전 계획을 지우지 않는다."""
        return SimulationPlan(**{**self.model_dump(), **answer.model_dump(exclude_defaults=True)})


class CharacterRef(BaseModel):
    """작가에게 보여 줄 세계관의 인물 카드(참여 인물 선택지)."""
    id: str
    name: str


class SimulationNeeds(BaseModel):
    """gate가 작가에게 묻는 내용: 지금까지의 계획과 빠진 것, 고를 수 있는 인물."""
    plan: SimulationPlan
    gaps: list[Gap]
    characters: list[CharacterRef]


class Beat(BaseModel):
    index: int
    text: str
    status: Literal['done', 'pending', 'rejected']


class Check(BaseModel):
    """오류 1~3(누설·말투·관계)과 IF 전제·비트 진행 검사 한 건. 오류 4~6은 후속 범위다."""
    kind: CheckKind
    passed: bool
    detail: str


class Evidence(BaseModel):
    """그 인물이 이번 턴에 조회한 근거(NovelBrain recall 항목)의 참조."""
    ref: str
    source: Literal['graph', 'manuscript', 'bm25']


class Turn(BaseModel):
    index: int
    characterId: str
    characterName: str
    prose: str
    checks: list[Check]
    regenerated: int
    evidence: list[Evidence]


class SimulationResult(BaseModel):
    """`character_simulation` 단계 결과. 흐름 모드의 premise는 None, IF 모드의 beats는 비어 있다."""
    mode: Mode
    premise: str | None
    beats: list[Beat]
    turns: list[Turn]
    status: Literal['running', 'completed', 'stopped', 'failed']
    stopReason: str | None


class PlanDraft(BaseModel):
    """계획 모델 출력. 요청에 없는 것은 None·빈 배열이다."""
    mode: Mode | None
    premise: str | None
    beats: list[str]
    characterIds: list[str]


class Action(BaseModel):
    """인물 턴 모델 출력. prose는 소설 문단(지문 + "대사"), observed는 다른 인물이 보고 들을 수 있는 것만이다."""
    prose: str
    observed: str
    refusesBeat: bool
    refusalReason: str | None


class CheckItem(BaseModel):
    kind: CheckKind
    passed: bool
    detail: str
    refs: list[str]


class Verdict(BaseModel):
    """검사 모델 출력. beatDone은 흐름 모드의 현재 비트가 이 문단으로 끝났는지, sceneComplete는 IF 장면이 완결됐는지다."""
    checks: list[CheckItem]
    beatDone: bool
    sceneComplete: bool
