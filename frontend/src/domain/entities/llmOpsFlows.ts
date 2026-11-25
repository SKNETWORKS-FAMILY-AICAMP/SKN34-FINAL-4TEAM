import type { PipelineFlowKey } from './admin'
import type { PipelineNode } from './llmOpsPipeline'

/**
 * 워크플로우(내부 흐름) 정의(#857 3차): 사이드바 '프롬프트·평가' 하위 탭이 고르는 흐름. '전체'(서버 노드 흐름)는 정의가 없고, 내부에 순서 있는 여러 LLM 단계가 있는 에이전트마다 하나씩 있다.
 * 단계·순서·프롬프트는 코드(backend/ai-service/app)와 설계 문서가 근거이고, 같은 에이전트의 프롬프트 전체와 같은지 llmOpsFlows.test.ts가 SEEDS(prompts.py)와 대조한다.
 * 건수·오류는 서버 고정 노드(GET /llmops/pipeline)가 있는 단계(server)에만 보인다. 서버 노드가 없는 단계는 구조용 노드(이름만, 점선)이고, 단계별 서버 노드는 예정이다
 * (docs/design/operations-ai-pipeline-contract.md). 서버가 지금 한 노드로 함께 세는 호출은 흐름의 parent 노드 집계로만 보인다.
 */
export type FlowStep = {
  /** 서버 노드와 1:1(server)이면 그 서버 노드 id, 아니면 '<흐름>:<단계>'(서버 노드가 응답에 없으면 그 단계도 flowNodes가 '<흐름>:<id>'로 내린다). */
  id: string
  label: string
  next: string[]
  /** 그 단계가 LLM 호출인지(아니면 코드·Content 처리). */
  llm: boolean
  server?: boolean
  /** 그 단계가 쓰는 프롬프트 코드. 구조용 단계의 '프롬프트 보기' 대상이다(서버 노드 단계는 서버가 준 promptNames). */
  prompts?: string[]
  /** 구조용 단계의 설명(코드 근거). */
  note?: string
}
export type FlowDef = {
  /** 전체에서 이 흐름이 안쪽인 서버 노드 id. 그 노드를 고르면 기록 패널에 '내부 흐름 보기'가 있고, 흐름 화면은 그 노드의 집계를 보인다. */
  node: string
  caption: string
  steps: FlowStep[]
}
type FlowKey = Exclude<PipelineFlowKey, 'all'>

const step = (id: string, label: string, next: string[], llm: boolean, note: string, prompts?: string[]): FlowStep => ({ id, label, next, llm, note, prompts })

export const FLOW_DEFS: Record<FlowKey, FlowDef> = {
  simulation: {
    node: 'character_simulation',
    caption: '장면은 한 턴씩 씁니다: 연출 결정 → 기억 회상 → 쓰기 → 검사를 되풀이해요. 점선은 되돌아가는 길로, 검사에서 위반이면 그 턴만 최대 2회 다시 쓰고 통과하면 다음 턴(연출 결정)으로 가요. 장면이 끝나면 작가가 승인한 장면만 초안에 반영돼요.',
    steps: [
      step('simulation:plan', '계획', ['simulation:director'], true,
        '작가 요청 문장에서 모드(흐름·IF)·전제·비트·참여 인물을 정한다. [시뮬레이션] 버튼으로 시작하면 양식을 그대로 계획으로 써서 이 호출이 없다.', ['character_simulation.plan']),
      step('simulation:director', '연출 결정', ['novelbrain'], true,
        '이번 턴(나레이션·독백·인물 대사·마무리)·화자·시점을 OpenAI Decisions API로 정한다. 규칙이 정한 턴은 모델에 묻지 않고 정할 수 있다(속도 스위치).', ['character_simulation.direct']),
      { id: 'novelbrain', label: 'NovelBrain 기억 회상', next: ['simulation:write'], llm: false, server: true,
        note: 'NovelBrain이 이 턴 화자(나레이터는 전체)가 아는 카드·관계·원고 조각만 찾아 입력으로 준다(검색, LLM 호출이 아니다). 서버 응답에 이 노드가 있으면 건수·오류·기록이 보인다.' },
      step('simulation:write', '턴 쓰기', ['simulation:check'], true,
        '연출이 정한 턴을 쓴다. 인물 대사는 act, 나레이션·독백·마무리는 narrate(독백은 시점 인물이 아는 범위)이고 그 인물이 아는 것만 입력으로 보낸다.',
        ['character_simulation.act', 'character_simulation.narrate']),
      step('simulation:check', '검사', ['simulation:apply', 'simulation:director', 'simulation:write'], true,
        '서버 규칙(말투·반복)과 검사 모델로 누설·말투·호칭·전제·시점을 본다(나레이션은 미래 누설만). 위반이면 그 턴만 최대 2회 다시 쓰고, 통과하면 장면에 붙여 다음 턴으로 간다.', ['character_simulation.check']),
      step('simulation:apply', '작가 승인·초안 반영', [], false,
        '장면이 끝나면 작가가 승인한 장면만 Content MCP로 회차 초안에 반영한다. 대화 안에서는 턴 사이마다 작가가 다음·수정·다시 쓰기·멈춤을 고를 수 있다.'),
    ],
  },
  preprocessing: {
    node: 'manuscript_extraction',
    caption: '작가가 [세계관 만들기]를 누르면 도는 원고 전처리(최초 구축) 작업의 흐름이에요. 회차마다 추출하고(4개씩 병렬) 정체 정리는 작품당 한 번이며, 정리·적재는 LLM이 아니에요.',
    steps: [
      step('preprocessing:claim', '접수·회차 읽기', ['preprocessing:extract'], false,
        'Celery 작업이 Content에 작업을 선점(claim)하고, 최초 접수 때 고정한 저장 버전의 원문 중 아직 추출하지 않은 회차를 받는다.'),
      step('preprocessing:extract', '회차별 추출', ['preprocessing:resolve'], true,
        '회차마다 LLM 1회(회차 4개씩 병렬)로 대상·진술·관계를 원문 근거와 함께 뽑아 Content에 저장한다. 근거를 확인하지 못한 항목만 빼고, 회차 하나라도 실패하면 정리 전에 작업이 멈춘다.',
        ['manuscript_extraction.extract']),
      step('preprocessing:resolve', '정체 정리', ['preprocessing:organize'], true,
        '모든 회차의 추출이 끝난 뒤 작품당 1회: 같은 종류·같은 이름은 기본으로 한 대상으로 묶고, 모델은 동명이인·별칭(「동일 인물」 후보) 링크만 알린다.', ['manuscript_extraction.resolve']),
      step('preprocessing:organize', '정리', ['preprocessing:load'], false, '검증된 결과만으로 카드·관계·사건을 결정적으로 구성한다(추가 LLM·원문 재조회 없음).'),
      step('preprocessing:load', '적재', [], false, 'Content가 정리 결과를 작품에 연결된 세계관 초안에 적재한다(작업 ID로 멱등).'),
    ],
  },
  review: {
    node: 'manuscript_review',
    caption: '검수 종류를 하나만 고르면 그 검수만 돌고, 둘 다(both)이면 Mechanical과 Semantic을 동시에 돌려요. Semantic만 설정을 읽어요.',
    steps: [
      step('review:read', '초안 읽기', ['review:mechanical', 'review:settings'], false, 'Content MCP로 그 회차 초안을 요청한 작가의 권한으로 읽는다.'),
      step('review:mechanical', 'Mechanical 검수', ['review:verify'], true, '수치·표기(인물·지명)·날짜·중복 표현·맞춤법만 본다. 초안만 모델에 보낸다.', ['manuscript_review.mechanical']),
      step('review:settings', '설정 읽기', ['review:semantic'], false, '연결(없으면 Fork가 이어받은) 세계관을 그 회차 시점 관계로 읽는다. Semantic 검수만 쓰고, 세계관이 없으면 설정 검수를 할 수 없다.'),
      step('review:semantic', 'Semantic 검수', ['review:verify'], true, '설정 충돌·인물이 알 수 없는 정보·감정 변화·서사 인과·복선을 본다. 초안과 그 회차 시점에 공개된 설정만 보낸다.', ['manuscript_review.semantic']),
      step('review:verify', '지적 검증·위치 찾기', [], false, '원고에 있는 구절·그 검수의 분류·보낸 근거만 받고 위치를 찾는다. 어긋나면 고치지 않고 실패하며, 위치를 모르는 확정 지적은 의심으로 낮춘다.'),
    ],
  },
  research: {
    node: 'research',
    caption: '조사 종류(task)에 따라 웹 조사(LLM 1회) 또는 공개 세계관 참고(세계관 고르기 → 참고 카드 고르기, LLM 2회)로 갈라져요.',
    steps: [
      step('research:ask', '조사 종류 고르기', ['research:web', 'research:list'], false, '메인 에이전트가 ask_research 도구를 task=web 또는 platform으로 부른다.'),
      step('research:web', '웹 조사', [], true, '작가가 동의한 질문·짧은 맥락만 웹 검색으로 확인하고 출처 URL을 단다. 실제 검색 결과에 없는 URL은 근거로 쓰지 않는다(외부 전송).', ['web_research.search']),
      step('research:list', '공개 세계관 목록 읽기', ['research:pick'], false, 'Content MCP로 다른 작가가 공개한 세계관 요약을 읽는다(내 세계관은 빼고, 쓰기 도구는 부르지 않는다).'),
      step('research:pick', '참고할 세계관 고르기', ['research:read'], true, '요청에 도움이 될 세계관을 최대 3개 고른다. 목록에 없는 세계관을 고르면 실패한다.', ['research.pick']),
      step('research:read', '세계관 상세 읽기', ['research:refer'], false, '고른 세계관의 설정 카드를 읽는다(카드 본문은 장당·전체 글자 상한으로 자른다).'),
      step('research:refer', '참고 카드 고르기', [], true, '읽은 카드 가운데 참고할 카드와 참고 방법을 고른다. 읽지 않은 카드를 인용하면 실패한다.', ['research.refer']),
    ],
  },
  writing: {
    node: 'writing',
    caption: '작업 종류(task)에 따라 달라요: 전개 기획(plan)은 1회, 바로 집필(draft)은 기획 → 원고 2회, 부분 수정(patch)은 1회, 계획 수정(revise_plan)은 계획 고르기 → 수정안 2회예요.',
    steps: [
      step('writing:ask', '작업 종류 고르기', ['writing:plan', 'writing:patch', 'writing:pick'], false, '메인 에이전트가 ask_writing 도구를 task(plan·draft·patch·revise_plan)와 함께 부른다.'),
      step('writing:plan', '전개 기획', ['writing:draft'], true, '요청·허용 문맥으로 전개 계획(1~3개, 비트 12개 이하)을 만든다. 원고 문장은 만들지 않는다. 기획만 하면(plan) 여기서 끝난다.', ['writing_editing.plan']),
      step('writing:draft', '원고 쓰기', [], true, '계획으로 새 회차 원고 제안을 쓴다. 계획 없이 바로 집필하면 위 기획이 계획 하나를 먼저 정한다.', ['writing_editing.draft']),
      step('writing:patch', '선택 구간 수정', [], true, '선택한 구간의 교체 문장만 만든다(선택 밖 문장은 구조적으로 바뀌지 않는다).', ['writing_editing.patch']),
      step('writing:pick', '고칠 계획 고르기', ['writing:revise'], true, '저장된 플롯·장면 계획 요약 목록에서 요청이 가리키는 계획 하나를 고른다. 하나로 정할 수 없으면 되묻는다.', ['writing_editing.plan_pick']),
      step('writing:revise', '계획 수정안', [], true, '고른 계획의 제목·내용만 지시대로 고친 변경 전·후 제안을 만든다. 바뀐 것이 없으면 되묻는다.', ['writing_editing.plan_revise']),
    ],
  },
}

/** 흐름 단계 id는 서버 노드 id와 겹치지 않게 ':'를 품는다(서버 노드 id에는 없다): 구조용 단계는 서버에 기록을 묻지 않는다. */
export const isFlowStepId = (id: string) => id.includes(':')

/** 그 서버 노드의 안쪽 흐름 키. 내부 흐름이 없는 노드는 null입니다. */
export const flowOfNode = (nodeId: string): FlowKey | null => (Object.entries(FLOW_DEFS).find(([, def]) => def.node === nodeId)?.[0] as FlowKey | undefined) ?? null

/**
 * 흐름 정의 + 서버 노드 목록 → 캔버스 노드. 전체는 서버 노드 그대로라 null입니다. 서버 노드와 1:1인 단계는 서버의 이름·건수·오류·프롬프트를 쓰되 연결은 흐름의 것이고,
 * 서버 노드가 없는(또는 응답에 없는) 단계는 건수·오류 없이 이름만 그리는 구조용 노드(step)입니다.
 */
export function flowNodes(key: PipelineFlowKey, server: PipelineNode[]): PipelineNode[] | null {
  if (key === 'all') return null
  const byId = new Map(server.map((n) => [n.id, n]))
  const steps = FLOW_DEFS[key].steps
  // 응답에 없는 서버 노드 단계는 구조용으로 내리고 id에 흐름 키를 붙인다: 구조용 id는 늘 ':'를 품어(isFlowStepId) 없는 서버 노드에 기록을 묻지 않는다.
  const ids = new Map(steps.map((s) => [s.id, s.server && !byId.has(s.id) ? `${key}:${s.id}` : s.id]))
  return steps.map((s): PipelineNode => {
    const own = s.server ? byId.get(s.id) : undefined
    const next = s.next.map((to) => ids.get(to) ?? to)
    return own
      ? { ...own, next, standalone: false }
      : { id: ids.get(s.id)!, label: s.label, next, standalone: false, count: 0, errors: 0, promptNames: s.prompts ?? [], step: { llm: s.llm, note: s.note } }
  })
}
