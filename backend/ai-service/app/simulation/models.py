"""인물 시뮬레이션 계약(docs/design/character-simulation-contract.md): 계획·턴·검사·결과 DTO와 모델 출력 형식.

결과 DTO(`SimulationResult`)는 계약 JSON 모양 그대로이며 오케스트레이션 단계 결과와 턴마다의 step 이벤트가 같은 모양을 쓴다.
`Scene`은 장면 에이전트 상태에 남는 장면(결과 + 턴별 기록 + 작가의 메모)이고 `SceneAction`은 작가의 장면 조작(resume.scene)이다.
모델 출력 DTO(`PlanDraft`·`Action`·`Narration`·`Verdict`)는 Structured Outputs 스키마라 길이·개수 제약을 두지 않고, 한도는 service가 다시 검증한다.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Mode = Literal['if', 'flow']
# 서술 시점: 전지적 / 인물의 3인칭 제한 / 인물의 1인칭. 인물은 카드 id다. 비트마다 바뀔 수 있다.
Pov = Annotated[str, Field(pattern=r'^(omniscient|limited:.+|first:.+)$')]
CheckKind = Literal['knowledge_leak', 'voice_mix', 'relation', 'premise', 'beat']
# 작가에게 되묻는 문구에 쓰는 고정 라벨(모델이 쓴 문장은 쓰지 않는다).
GAP_LABELS = {'mode': '모드(IF 또는 흐름)', 'premise': 'IF 전제("만약 ~했다면?")', 'beats': '장면 비트', 'characterIds': '참여 인물'}


class SimulationPlan(BaseModel):
    """모드·전제·비트·참여 인물. 메인 에이전트가 작가의 요청 문장에서 뽑는다. 정하지 못한 값은 gaps()이며 작가에게 되묻는다."""
    model_config = ConfigDict(extra='forbid')
    mode: Mode | None = None
    premise: str | None = Field(default=None, min_length=1, max_length=500)
    beats: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default=[], max_length=8)
    characterIds: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default=[], max_length=6)

    def gaps(self) -> list[str]:
        """실행 전에 작가가 더 알려 줘야 하는 것. IF는 전제 하나, 흐름은 비트 목록이 필요하다."""
        gaps: list[str] = []
        if self.mode is None:
            gaps.append('mode')
        elif self.mode == 'if' and not self.premise:
            gaps.append('premise')
        elif self.mode == 'flow' and not self.beats:
            gaps.append('beats')
        if not self.characterIds:
            gaps.append('characterIds')
        return gaps


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
    """장면의 한 줄. 나레이션(나레이터의 지문)은 인물이 없고 이름이 '나레이션'이다. 독백은 시점 인물의 속마음이며 나레이터가 쓴다.

    pov는 이 턴을 연출할 때 고른 서술 시점이다. 나레이션·독백은 검사 결과를 내보이지 않는다.
    """
    index: int
    kind: Literal['narration', 'monologue', 'character'] = 'character'
    characterId: str | None
    characterName: str
    prose: str
    checks: list[Check]
    regenerated: int
    evidence: list[Evidence]
    pov: Pov = 'omniscient'
    editedByAuthor: bool = False


class Note(BaseModel):
    """작가가 장면 중에 끼어들어 남긴 연출 지시. afterTurn번째 턴 뒤에 들어왔고 다음 턴(나레이션)부터 반영된다."""
    afterTurn: int
    text: str


class SimulationResult(BaseModel):
    """`character_simulation` 단계 결과. 흐름 모드의 premise는 None, IF 모드의 beats는 비어 있다.

    running은 첫 턴 전, paused는 턴 사이(작가의 조작을 기다림), completed는 장면 끝, stopped·failed는 멈춘 부분 결과(stopReason)다.
    notice는 실패는 아니지만 작가가 알아야 할 진행 조건이다(원고 발췌 검색을 쓸 수 없어 세계관 설정만으로 쓴 경우). 한 번 붙으면 장면이 끝날 때까지 남는다.
    """
    mode: Mode
    premise: str | None
    beats: list[Beat]
    turns: list[Turn]
    notes: list[Note] = []
    status: Literal['running', 'paused', 'completed', 'stopped', 'failed']
    stopReason: str | None
    notice: str | None = None


class Decision(BaseModel):
    """연출 결정: 이번 턴을 나레이션·독백·대사·마무리 중 무엇으로 쓰고, 누가 말하며, 어느 시점으로 쓸지. 인물은 카드 id다."""
    turn: Literal['narration', 'monologue', 'speech', 'end']
    speaker: str | None = None  # 대사(speech)일 때만
    pov: Pov


class Trail(BaseModel):
    """턴 하나의 장면 기록(작가에게 내보이는 결과에는 없다): 연출 결정, 다른 인물에게 보이는 것, 비트·완결 표시. 결과의 턴과 같은 순서다."""
    decision: Decision
    observed: str             # 다른 인물에게 보이는 것. 독백은 비어 있다
    beat: int | None = None   # 이 턴이 진행한 비트(흐름 모드)
    done: bool = False        # 이 인물 턴이 그 비트를 끝냈다
    ended: bool = False       # 이 인물 턴으로 이야기가 끝났다(마무리가 뒤따른다)
    closing: bool = False     # 이 나레이션이 장면을 마무리했다
    note: str | None = None   # 이 나레이션을 쓰게 한 끼어들기 메모(다시 쓸 때 되살린다)


class Scene(BaseModel):
    """장면 에이전트 상태에 남는 장면. 턴은 한 번에 하나씩 붙고, 작가의 메모·지시는 다음에 만드는 턴이 쓰고 비운다."""
    result: SimulationResult
    trail: list[Trail] = []
    memo: str | None = None      # 끼어들기 메모: 다음 턴을 나레이션으로 먼저 쓴다
    hint: str | None = None      # 다시 말하기 지시: 다시 쓰는 인물 턴이 따른다
    redo: Decision | None = None  # 다시 쓰는 턴의 기록된 연출 결정(연출을 다시 정하지 않고 이 결정으로 쓴다)
    error: str | None = None     # 멈춘 이유(작가에게 보이는 문구)
    declined: bool = False       # 작가가 장면을 반영하지 않기로 했다


class SceneAction(BaseModel):
    """작가의 장면 조작(resume.scene). next는 다음 턴(note는 끼어들기), edit는 그 턴의 글을 작가 글로, redo는 그 턴부터 다시, stop은 지금까지로 끝낸다."""
    model_config = ConfigDict(extra='forbid')
    action: Literal['next', 'edit', 'redo', 'stop']
    turn: int | None = Field(default=None, ge=0)
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    note: str | None = Field(default=None, max_length=300)

    @model_validator(mode='after')
    def fits_the_action(self):
        if ((self.turn is not None) != (self.action in ('edit', 'redo')) or (self.text is not None) != (self.action == 'edit')
                or (self.note is not None and self.action in ('edit', 'stop')) or (self.action == 'edit' and not self.text.strip())):
            raise ValueError('조작에 맞지 않는 값입니다.')
        return self


class PlanDraft(BaseModel):
    """계획 모델 출력. 요청에 없는 것은 None·빈 배열이다."""
    mode: Mode | None
    premise: str | None
    beats: list[str]
    characterIds: list[str]


class Action(BaseModel):
    """인물 턴 모델 출력. prose는 이 인물의 "대사"와 짧은 행동뿐(배경은 나레이터 몫), observed는 다른 인물이 보고 들을 수 있는 것만이다."""
    prose: str
    observed: str
    refusesBeat: bool
    refusalReason: str | None


class Narration(BaseModel):
    """나레이터 모델 출력. prose는 지문 문단(대사 없음), observed는 그 자리의 모든 인물이 보고 듣고 알 수 있는 것만이다(독백은 비운다)."""
    prose: str
    observed: str


class CheckItem(Check):
    """검사 모델 출력의 검사 한 건. 위반 근거가 된 입력 항목의 ref(refs)가 더 있다."""
    refs: list[str]


class Verdict(BaseModel):
    """검사 모델 출력. beatDone은 흐름 모드의 현재 비트가 이 문단으로 끝났는지, sceneComplete는 IF 장면이 완결됐는지다."""
    checks: list[CheckItem]
    beatDone: bool
    sceneComplete: bool
