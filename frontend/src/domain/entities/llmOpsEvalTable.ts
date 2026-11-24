import type { Evaluation } from './llmOps'

/**
 * LLMOps 화면 '에이전트별 평가' 표(#837)의 기준 목록이다. 같은 표가 docs/evaluation/retrieval.md §1.1에 있고 llmOpsEvalTable.test.ts가 둘이 같은지 본다.
 * 모드는 둘이다. 새 답변 생성은 고정 근거로 프롬프트 버전이 새 답변을 만들게 해 채점하는 회귀 평가(이 화면에서 실행)이고,
 * 원문 검색은 모델 없이 고정 원문에서 검색 순위만 채점하는 CI 고정 평가(#830)라 이 화면에 실행 버튼이 없다. 저장한 답변을 다시 채점하는 모드는 만들지 않았다(사용자 결정 2026-11-24).
 */
export type AgentEvaluation = {
  agent: string
  /** 평가하는 기능(프롬프트 이름·검색 함수·기능 설명). */
  feature: string
  mode: '새 답변 생성' | '원문 검색' | '—'
  /** 평가 세트와 항목 수. 세트가 없거나 쓰지 않는 행은 그 이유다. */
  set: string
  /** 회귀 평가 세트 이름. 있으면 평가 목록에서 이 세트의 가장 최근 Run을 '최근 결과'로 보인다. */
  dataset?: string
  metrics: string
  /** '최근 결과' 칸의 글. 회귀 평가 행(dataset 있음)은 이 글 대신 최근 Run을 보인다. */
  result: string
  /**
   * 이 행이 평가하는 프롬프트 이름(#857): 화면이 행에서 그 프롬프트 상세(개선 루프)로 이동하는 버튼을 단다. feature가 프롬프트 이름인 행에만 있고,
   * 범용 세트(`leak.spoiler`·`world.conflict`·`writing.fix`)·검색 행·여러 프롬프트를 묶은 행은 프롬프트가 하나로 정해지지 않아 없다.
   */
  prompt?: string
}

export const NO_SET = '평가 세트 없음(후속)'
export const RECENT_RUN = '최근 Run'
const CI = '버튼 없음 · CI에서 확인'
const NONE = { mode: '—', set: NO_SET, metrics: '—', result: '—' } as const

export const AGENT_EVALUATIONS: AgentEvaluation[] = [
  { agent: '메인 에이전트', feature: 'orchestration.main', prompt: 'orchestration.main', ...NONE },
  { agent: 'Decision Guard', feature: 'decision_guard.judge', prompt: 'decision_guard.judge', ...NONE },
  { agent: 'Q&A', feature: 'story_context.answer', prompt: 'story_context.answer', mode: '새 답변 생성', set: 'qa.grounding(6)', dataset: 'qa.grounding', metrics: 'faithfulness(근거 충실도) · context_precision(문맥 정밀도)', result: RECENT_RUN },
  { agent: 'Q&A', feature: '비공개 설정 누설(Fork 응답)', mode: '새 답변 생성', set: 'leak.spoiler(5)', dataset: 'leak.spoiler', metrics: 'GEval 누설 점수', result: RECENT_RUN },
  { agent: 'Q&A', feature: '설정·관계 발췌(world_excerpts)', mode: '원문 검색', set: '한국어 62문항(설정 14·누설 62)', metrics: 'Recall@8 · MRR@8 · 비공개 설정 누설', result: `${CI} — setting Recall@8 1.00 · MRR@8 0.92, 누설 0건` },
  { agent: 'Q&A', feature: '원고 벡터 검색(Content)', ...NONE, mode: '원문 검색' },
  { agent: 'Manuscript Review', feature: 'manuscript_review.*', ...NONE },
  { agent: 'World', feature: '설정 충돌 지적', mode: '새 답변 생성', set: 'world.conflict(5)', dataset: 'world.conflict', metrics: 'GEval(항목별 기준문)', result: RECENT_RUN },
  { agent: 'Writing', feature: '집필 교정', mode: '새 답변 생성', set: 'writing.fix(5)', dataset: 'writing.fix', metrics: 'GEval(항목별 기준문)', result: RECENT_RUN },
  { agent: 'Research', feature: 'web_research.search', prompt: 'web_research.search', ...NONE },
  { agent: 'Research', feature: '웹 검색 결과', mode: '원문 검색', set: '제외(결과가 시점마다 달라 재현 불가)', metrics: '—', result: '—' },
  { agent: 'Rating', feature: 'rating.assess', prompt: 'rating.assess', ...NONE },
  { agent: '인물 시뮬레이션', feature: 'character_simulation.act', prompt: 'character_simulation.act', mode: '새 답변 생성', set: 'simulation.act(24)', dataset: 'simulation.act', metrics: 'voice(말투) · intent(의도) · pov_ok(시점)', result: RECENT_RUN },
  { agent: '인물 시뮬레이션', feature: 'character_simulation.narrate', prompt: 'character_simulation.narrate', mode: '새 답변 생성', set: 'simulation.narrate(46)', dataset: 'simulation.narrate', metrics: 'style(문체) · info(정보) · pov_ok(시점)', result: RECENT_RUN },
  { agent: '인물 시뮬레이션', feature: '기억 회상(NovelBrain recall)', mode: '원문 검색', set: '한국어 62문항(고정 스냅샷)', metrics: 'Recall@5 · P@5 · MRR@5 · 미래·비목격 누설', result: `${CI} — 3단계 known Recall@5 0.96 · MRR@5 0.51, setting 0.86 · 0.65, 미래 누설 0.08` },
  { agent: '전처리 설정 추출', feature: 'manuscript_extraction.extract', prompt: 'manuscript_extraction.extract', mode: '새 답변 생성', set: 'extraction.extract(30)', dataset: 'extraction.extract', metrics: 'recall(재현율) · quote_ok(인용 통과율)', result: RECENT_RUN },
]

/** 평가 목록에서 그 세트의 가장 최근 Run. 목록 순서를 믿지 않고 시각으로 고르며, 다른 세트의 Run은 대신하지 않는다. */
export const latestRun = (dataset: string, evaluations: Evaluation[]) =>
  evaluations.filter((e) => e.dataset === dataset).reduce<Evaluation | undefined>((latest, e) => (!latest || Date.parse(e.createdAt) > Date.parse(latest.createdAt) ? e : latest), undefined)

/**
 * 그 프롬프트의 짝 평가 세트(#857): 에이전트별 평가 표에서 그 프롬프트를 새 답변 생성으로 평가하는 행. 후보 등록 평가 게이트의 짝(운영 서비스 `PromptService`의 EVALUATION_SETS,
 * 프롬프트 응답의 `evaluationDataset`)이 이 안에 있고 llmOpsEvalTable.test.ts가 같은지 본다. 짝 세트가 없으면 빈 목록이다.
 */
export const pairSets = (prompt: string) => AGENT_EVALUATIONS.filter((row) => row.prompt === prompt && row.dataset)

/** 평가 세트 칸의 항목 수(`qa.grounding(6)`의 괄호 안 수). 항목 수가 없는 칸은 없음이다. */
export const setItems = ({ set }: Pick<AgentEvaluation, 'set'>) => {
  const items = /\((\d+)\)$/.exec(set)?.[1]
  return items ? Number(items) : undefined
}

/**
 * 프롬프트 상세의 평가 단계에 보일 Run: 그 프롬프트 짝 세트의 Run과, 이 프롬프트를 다른(범용) 세트로 돌린 Run. 다른 프롬프트가 다른 세트로 돌린 Run은 거른다.
 * 직접 돌린 범용 세트 평가가 목록에서 사라지지 않게 프롬프트 이름이 같은 Run도 남기며, 목록 순서(서버의 최신순)는 그대로다.
 */
export const promptRuns = (prompt: string, evaluations: Evaluation[]) => {
  const sets = pairSets(prompt).flatMap((row) => row.dataset ?? [])
  return evaluations.filter((e) => e.prompt === prompt || sets.includes(e.dataset))
}
