/**
 * 프롬프트의 한국어 표시 이름(#857): 화면이 영어 코드(`character_simulation.act`)만 보여 무슨 프롬프트인지 알 수 없던 문제를 푼다.
 * 코드 → 이름 표 하나가 정본이고, 이름은 '<영역> · <무슨 호출인지>(<코드 끝 마디>)' 모양이며 영역은 에이전트별 평가 표의 에이전트 이름과 같다.
 * 키는 AI 서비스가 기동 때 등록하는 프롬프트(`backend/ai-service/app/prompts.py` SEEDS)와 같고 promptNames.test.ts가 같은지 본다: 프롬프트를 더하면 여기에도 이름을 더한다.
 */
export const PROMPT_NAMES = new Map<string, string>([
  ['orchestration.main', '메인 에이전트 · 작가 요청 처리(main)'],
  ['orchestration.summary', '메인 에이전트 · 이전 대화 요약(summary)'],
  ['decision_guard.judge', 'Decision Guard · 요청 판정(judge)'],
  ['story_context.answer', 'Q&A · 작품 질문 답변(answer)'],
  ['writing_editing.plan', 'Writing · 전개 기획(plan)'],
  ['writing_editing.plan_pick', 'Writing · 고칠 계획 고르기(plan_pick)'],
  ['writing_editing.plan_revise', 'Writing · 계획 수정(plan_revise)'],
  ['writing_editing.draft', 'Writing · 회차 원고 쓰기(draft)'],
  ['writing_editing.patch', 'Writing · 선택 문장 고치기(patch)'],
  ['manuscript_review.mechanical', 'Manuscript Review · 수치·표기·맞춤법 검수(mechanical)'],
  ['manuscript_review.semantic', 'Manuscript Review · 설정 충돌·인과 검수(semantic)'],
  ['world_review.check', 'World · 설정집 오류 검토(check)'],
  ['world_review.enrich', 'World · 설정집 보강(enrich)'],
  ['world_review.impact', 'World · 설정 변경 영향 분석(impact)'],
  ['world_review.fill', 'World · 인물 문서 채우기(fill)'],
  ['web_research.search', 'Research · 웹 고증 검색(search)'],
  ['research.pick', 'Research · 참고 세계관 고르기(pick)'],
  ['research.refer', 'Research · 참고 설정 카드 찾기(refer)'],
  ['rating.assess', 'Rating · 회차 심의(assess)'],
  ['character_simulation.plan', '인물 시뮬레이션 · 시뮬레이션 계획(plan)'],
  ['character_simulation.act', '인물 시뮬레이션 · 인물 대사(act)'],
  ['character_simulation.narrate', '인물 시뮬레이션 · 나레이션·독백(narrate)'],
  ['character_simulation.check', '인물 시뮬레이션 · 문단 검사(check)'],
  ['character_simulation.direct', '인물 시뮬레이션 · 장면 연출(direct)'],
  ['proposals.continue', '이어쓰기 제안 · 다음 문단 제안(continue)'],
  ['initial_world.extract', '초기 세계관 · 설정 후보 추출(extract)'],
  ['manuscript_extraction.extract', '전처리 설정 추출 · 회차 설정 추출(extract)'],
  ['manuscript_extraction.resolve', '전처리 설정 추출 · 같은 대상 판별(resolve)'],
  ['work_tags.suggest', '작품 태그 · 장르·키워드 제안(suggest)'],
  ['serial.choices_v2', 'AI 연재 · 선택지 제안(choices_v2)'],
  ['serial.episode_summary', 'AI 연재 · 회차 요약(episode_summary)'],
  ['serial.simulation_v2', 'AI 연재 · 장면 미리보기(simulation_v2)'],
  ['serial.vote_summary', 'AI 연재 · 투표·제안 종합(vote_summary)'],
  ['serial.episode_draft', 'AI 연재 · 회차 원고 쓰기(episode_draft)'],
  ['serial.episode_review_v3', 'AI 연재 · 회차 검수(episode_review_v3)'],
])

/** 코드의 한국어 표시 이름. 표에 없는 코드(옛 이름·데모 이름·새로 생긴 프롬프트)는 코드 그대로입니다. */
export const promptLabel = (code: string) => PROMPT_NAMES.get(code) ?? code
