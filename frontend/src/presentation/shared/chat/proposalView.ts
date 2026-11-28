import { stepText, type ChatReply } from '../../../domain/entities/writingChat'

/** 비교 칸 하나. mark는 강조할 구간이고 pre·post는 그 앞뒤 글이다(강조가 없으면 pre만 쓴다). */
export type ProposalColumn = { label: string; pre: string; mark: string; post: string }
export type ProposalView = {
  kind: 'draft' | 'patch' | 'plan'
  /** 반영 회차(서버가 알려 준 값). 계획 수정안은 회차에 반영하지 않아 null이다. */
  episode: number | null
  /** 비교하려면 열어야 하는 회차. 이미 열려 있거나 열 회차를 모르면 null이다(열린 회차로 대신하지 않는다, #635). */
  openEpisode: number | null
  notice: string
  /** 지금 원고·계획 칸. 비교할 수 없으면 null이다. */
  current: ProposalColumn | null
  proposal: ProposalColumn
}

const column = (label: string, pre = '', mark = '', post = ''): ProposalColumn => ({ label, pre, mark, post })

/** 서버가 승인을 기다리는 결과 단계(orchestration `_pending`과 같은 규칙): 완료됐고 아직 답하지 않았으며 기획 결과(plans)·World 검사·영향 분석이 아니다. */
export const pendingStep = (reply: ChatReply, feature: 'world' | 'writing_editing') =>
  reply.steps.find((s) => s.feature === feature && s.status === 'completed' && !s.approval
    && !(s.result && 'plans' in s.result) && s.task !== 'check' && s.task !== 'impact')

/**
 * 원고 영역(집필실)에 크게 보일 승인 제안만 골라 비교 칸으로 만든다: 원고 반영 승인(초안·부분 수정·조건부 수정)과 계획 수정안.
 * World·Content 작업·시뮬레이션 승인과 보일 제안이 없는 대기는 null이라 채팅 카드로 남는다.
 * open은 편집기가 지금 연 회차의 번호와 본문이다. 반영 회차와 다르면 그 본문으로 대신 비교하지 않는다.
 */
export function proposalStageView(reply: ChatReply | null, open: { number: number; body: string } | null): ProposalView | null {
  if (reply?.awaitingApproval !== 'writing_editing') return null
  const step = pendingStep(reply, 'writing_editing')
  if (!step) return null

  if (step.task === 'revise_plan') { // 읽지 못한 수정안(planRevision 없음)은 채팅 카드가 저장을 잠근다
    const revision = step.planRevision
    if (!revision) return null
    const text = (p: { title: string; content: string }) => `${p.title}\n\n${p.content}`
    return { kind: 'plan', episode: null, openEpisode: null, notice: '', current: column('지금 계획', text(revision.before)), proposal: column('수정안', text(revision.after)) }
  }

  const episode = reply.approvalEpisode ?? null
  const comparable = episode !== null && open?.number === episode
  const body = comparable ? open.body : '' // 비교할 지금 초안(반영 회차가 열린 회차일 때만)
  const openEpisode = episode !== null && !comparable ? episode : null
  const notice = openEpisode !== null ? `${openEpisode}화 초안에 반영하는 제안이에요. ${openEpisode}화를 열어 비교해 주세요.`
    : episode === null ? '반영할 회차를 알 수 없어 지금 원고와 비교할 수 없어요.' : ''
  const { before, after } = step.result ?? {}

  if (after !== undefined) { // 부분 수정·조건부 수정: 수정 전·후 글만 있다
    const old = before ?? ''
    const at = comparable && old ? body.indexOf(old) : -1
    // 서버는 수정 전 글이 초안에 한 번만 있을 때만 바꾼다(place): 여러 곳이면 어느 곳인지 꾸며 강조하지 않는다.
    const repeated = at >= 0 && body.indexOf(old, at + 1) >= 0
    if (at >= 0 && !repeated) {
      const head = body.slice(0, at), tail = body.slice(at + old.length)
      return { kind: 'patch', episode, openEpisode, notice, current: column(`지금 초안 · ${episode}화`, head, old, tail), proposal: column('제안', head, after, tail) }
    }
    return { kind: 'patch', episode, openEpisode, current: column('수정 전', '', old), proposal: column('수정 후', '', after),
      notice: notice || (repeated ? '수정 전 글이 지금 초안 여러 곳에 있어 바뀌는 구간만 보여요.' : '수정 전 글을 지금 초안에서 찾지 못해 바뀌는 구간만 보여요.') }
  }

  // 새 원고는 초안 끝에 이어 붙는다(Content render_writing): 오른쪽은 반영 후 모습이고 붙는 글만 강조한다.
  const text = stepText(step)
  return comparable
    ? { kind: 'draft', episode, openEpisode, notice, current: column(`지금 초안 · ${episode}화`, body), proposal: column('반영 후', body.trim() ? `${body}

` : '', text) }
    : { kind: 'draft', episode, openEpisode, notice, current: null, proposal: column('제안 · 초안 끝에 이어 붙여요', text) }
}

/** 채팅에 남는 한 줄(원고 영역에서 보기 링크 옆). */
export const proposalLine = (view: ProposalView) => view.kind === 'plan' ? '계획 수정안 · 저장 여부를 기다려요'
  : `${view.episode ? `${view.episode}화 ` : ''}초안 반영 제안 · 반영 여부를 기다려요`
