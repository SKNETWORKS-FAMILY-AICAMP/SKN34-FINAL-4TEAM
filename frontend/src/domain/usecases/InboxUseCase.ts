import { isMine } from '../entities/work'
import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { WorkRepository } from '../repositories/WorkRepository'

export type InboxAct = 'approve' | 'reject' | 'resolve' | 'publishRevision'

/** 목업 inbox() cls(): 진행 중(wait)·거절(빈 값)·완료(ok) 표시 */
export const inboxCls = (s: string) => ['필터 대기', '접수됨', '분석 중', '작가 검토 대기', '수정 진행 중', '발행 대기', '보류', '처리 실패', '발행 실패'].includes(s) ? 'wait' : s === '거절됨' || s === '철회됨' ? '' : 'ok'

/** 목업 inbox()·act==='approve'|'reject'|'resolve'|'publishRevision': U20 독자 피드백함. 원문은 작가가 승인·발행해야만 바뀝니다. */
export class InboxUseCase {
  private readonly workRepository: WorkRepository
  private readonly feedbackRepository: FeedbackRepository
  constructor(workRepository: WorkRepository, feedbackRepository: FeedbackRepository) {
    this.workRepository = workRepository
    this.feedbackRepository = feedbackRepository
  }

  async list(sel: string | null) {
    const [works, inbox] = await Promise.all([this.workRepository.listWorks(), this.feedbackRepository.listInbox()])
    const it = inbox.find((x) => x.id === sel) ?? inbox[0]
    const w = it && works.find((x) => x.id === it.w)
    return {
      items: inbox.map((x) => ({ ...x, title: works.find((w2) => w2.id === x.w)?.title ?? '' })),
      it, current: it?.from && w ? w.eps[it.n - 1]?.p[it.pi] ?? '' : '',
    }
  }

  /** 처리 결과 안내 문구를 돌려줍니다. 내 작품이 아니면 null */
  async act(id: string, act: InboxAct, answer = ''): Promise<string | null> {
    const [works, inbox, reports] = await Promise.all([this.workRepository.listWorks(), this.feedbackRepository.listInbox(), this.feedbackRepository.listReports()])
    const it = inbox.find((i) => i.id === id)
    const w = it && works.find((x) => x.id === it.w)
    if (!it || !w || !isMine(w)) return null
    const r = reports.find((x) => x.id === it.rid)
    const save = async (msg: string) => {
      await this.feedbackRepository.saveInbox(it)
      if (r) await this.feedbackRepository.saveReport(r)
      return msg
    }
    if (act === 'approve') {
      const current = w.eps[it.n - 1]?.p[it.pi]
      if (!current || (it.baseText !== undefined && current !== it.baseText)) { it.status = '반영 실패'; return save('원문이 변경되어 수정안을 다시 검토해 주세요') }
      it.baseText = current
      it.status = '승인됨'
      if (r) r.status = '수정 진행 중'
      return save('수정안을 승인했어요. 발행은 별도로 확인해 주세요')
    }
    if (act === 'publishRevision') {
      const ep = w.eps[it.n - 1], text = ep?.p[it.pi]
      if (it.status !== '승인됨' || w.hidden || !text || text !== it.baseText || !it.from || !text.includes(it.from)) { it.status = '반영 실패'; return save('원고나 공개 상태가 바뀌어 발행하지 않았어요') }
      ep.p[it.pi] = text.replace(it.from, it.to ?? '')
      await this.workRepository.saveWork(w)
      it.status = '발행 완료'
      if (r) r.status = '처리 완료'
      return save('수정안을 발행했어요 (데모)')
    }
    if (act === 'reject') {
      it.status = '거절됨'
      if (r) r.status = '처리 완료'
    } else {
      // 목업은 '의도한 설정이에요'·'답변 보내기' 모두 상태를 '처리 완료'로 둡니다 (목업 그대로).
      it.status = '처리 완료'
      it.answer = answer.trim()
      if (r) { r.status = '처리 완료'; if (answer.trim()) r.reply = '작가 답변: ' + answer.trim() }
    }
    return save('처리했어요 (데모)')
  }
}
