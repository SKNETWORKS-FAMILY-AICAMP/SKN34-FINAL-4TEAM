import { TYPO, type Comment, type FeedbackType, type Sentence } from '../entities/feedback'
import { epsOf, isMine, type Work } from '../entities/work'
import type { AdminRepository } from '../repositories/AdminRepository'
import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { WorkRepository } from '../repositories/WorkRepository'

let uid = 1
const nid = (p: string) => p + uid++

/** 목업 mockReply('오류 제보'): 본문에서 아는 표기 오류를 찾으면 수정 제안으로 보냅니다. */
function typoReply(w: Work, n: number, sent: Sentence, text: string) {
  const par = epsOf(w)[n - 1]?.p[sent.pi] ?? ''
  const key = Object.keys(TYPO).find((k) => (sent.t + ' ' + text).includes(k) && par.includes(k))
  if (key) return { key, reply: `본문에서 “${key}” 표기를 확인했어요 (→ “${TYPO[key]}”). 작가님께 수정 제안으로 보냈고, 작가님이 승인하면 이 회차에 반영돼요.` }
  return { key: undefined, reply: '본문에서 확실한 오류를 찾지 못했어요. 오류로 단정하지 않고 작가님께 그대로 전달했어요.' }
}

/** 회차 댓글, 문장 피드백, 소설 신고 (목업 addComment·feedbackSheet·reportSheet) */
export class FeedbackUseCase {
  private readonly workRepository: WorkRepository
  private readonly feedbackRepository: FeedbackRepository
  private readonly adminRepository: AdminRepository
  constructor(workRepository: WorkRepository, feedbackRepository: FeedbackRepository, adminRepository: AdminRepository) {
    this.workRepository = workRepository
    this.feedbackRepository = feedbackRepository
    this.adminRepository = adminRepository
  }

  private async work(id: string) {
    const w = (await this.workRepository.listWorks()).find((x) => x.id === id)
    if (!w) throw new Error('소설을 찾을 수 없어요')
    return w
  }

  /** 관리자가 숨긴 댓글(시드 `테마-i`, 독자 `runtime-작품-회차-i`)은 뺍니다. 좋아요 key는 목업처럼 작품 ID + 회차 + 'c' + 걸러진 순번입니다. */
  async getComments(w: Work, n: number) {
    const [all, liked, { hiddenComments }] = await Promise.all([this.feedbackRepository.listComments(w.theme, w.id + n), this.feedbackRepository.listCommentLikes(), this.adminRepository.get()])
    // 회차 키는 항상 작품ID+회차라서 빈 키로 조회하면 시드만 돌아온다
    const seeds = (await this.feedbackRepository.listComments(w.theme, '')).length
    const comments = all.filter((_, i) => !hiddenComments.includes(i < seeds ? `${w.theme}-${i}` : `runtime-${w.id}-${n}-${i - seeds}`))
    return { comments, liked }
  }

  async addComment(workId: string, n: number, nick: string, text: string, sent: Sentence | null, spoiler = false) {
    const comment: Comment = [nick, text, 0, { q: sent ? sent.t : '', spoiler }]
    await this.feedbackRepository.addComment(workId + n, comment)
    return '댓글을 남겼어요'
  }

  toggleCommentLike(key: string) {
    return this.feedbackRepository.toggleCommentLike(key)
  }

  async sendFeedback(o: { workId: string; n: number; sentence: Sentence; type: FeedbackType; text: string; verified: boolean; nick: string }) {
    const w = await this.work(o.workId)
    const proposal = o.type === '단순 오류' ? typoReply(w, o.n, o.sentence, o.text) : null
    const par = w.eps[o.n - 1]?.p
    // 목업 typoAuto: 작품 설정의 자동 승인이 켜져 있으면 본문을 바로 고치고 피드백함에 넣지 않습니다.
    const autoApplied = !!(proposal?.key && w.settings?.typoAuto && !w.hidden && par?.[o.sentence.pi]?.includes(proposal.key))
    if (autoApplied && par && proposal?.key) {
      par[o.sentence.pi] = par[o.sentence.pi].replace(proposal.key, TYPO[proposal.key])
      await this.workRepository.saveWork(w)
    }
    const [status, message] =
      autoApplied ? ['처리 완료', '작품 설정의 자동 승인으로 표기 오류 수정안을 발행했어요 (데모).']
        : proposal ? ['작가 검토 대기', proposal.reply]
        : o.type === '질문' ? ['응답 완료', `공개된 ${o.n}화의 선택 문장을 근거로 답변을 준비했어요 (데모): “${o.sentence.t}”`]
          : o.type === '스토리 오류' ? ['작가 검토 대기', o.verified ? '검증 시뮬레이션 동의를 확인했어요. 실제 분석은 연결되지 않아 작가 검토 대상으로 접수했어요.' : '스토리 오류는 자동 판단하지 않고 작가 검토 대상으로 접수했어요.']
            : ['작가 검토 대기', '전개 제안을 오류로 단정하지 않고 작가 검토 대상으로 접수했어요.']
    const rid = nid('f')
    await this.feedbackRepository.addReport({ id: rid, w: o.workId, n: o.n, type: o.type, text: o.text, status, reply: message })
    if (isMine(w) && o.type !== '질문' && !autoApplied) {
      await this.feedbackRepository.addInbox({
        id: nid('i'), rid, w: o.workId, n: o.n, pi: o.sentence.pi, type: o.type, who: o.nick, text: o.text, baseText: w.eps[o.n - 1]?.p[o.sentence.pi] ?? '',
        status: '작가 검토 대기', ai: { cls: o.type, why: '사용자가 고른 유형을 그대로 전달합니다. 자동 분류하지 않았어요.', ev: o.sentence.t },
        from: proposal?.key, to: proposal?.key && TYPO[proposal.key],
      })
    }
    return { status, message }
  }

  async reportWork(o: { workId: string; type: string; text: string; nick: string }) {
    await this.work(o.workId)
    const id = nid('r')
    const message = '신고를 운영팀에 접수했어요. 검토 결과를 확인할 수 있도록 이 데모에 기록했습니다.'
    await this.feedbackRepository.addReview({ id, w: o.workId, n: null, type: o.type, text: o.text, quote: '', status: '접수', who: o.nick })
    await this.feedbackRepository.addReport({ id, w: o.workId, n: null, type: '신고 · ' + o.type, text: o.text, status: '접수됨', reply: message })
    return message
  }
}
