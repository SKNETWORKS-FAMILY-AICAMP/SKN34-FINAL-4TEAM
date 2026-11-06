import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { FeedbackType, Sentence } from '../../../../domain/entities/feedback'
import type { FeedbackUseCase } from '../../../../domain/usecases/FeedbackUseCase'
import { toast } from '../../../shared/events'
import { sessionActions } from '../../../shared/session/sessionSlice'

/** 댓글·피드백·신고 시트 동작 (목업 commentSheet·feedbackSheet·reportSheet) */
export function useFeedbackViewModel(feedbackUseCase: FeedbackUseCase = appContainer.resolve('feedbackUseCase')) {
  const nick = useAppSelector((s) => s.session.user.nick)
  const dispatch = useAppDispatch()
  const changed = () => dispatch(sessionActions.dataChanged())
  return {
    /** 빈 내용이면 false. 등록하면 목록을 다시 불러오고 안내를 띄웁니다. */
    addComment: async (workId: string, n: number, text: string, sent: Sentence | null, spoiler = false) => {
      const v = text.trim()
      if (!v) return toast('댓글 내용을 입력해 주세요'), false
      const note = await feedbackUseCase.addComment(workId, n, nick, v, sent, spoiler)
      changed()
      toast(note)
      return true
    },
    /** 빈 내용이면 null, 접수하면 상태와 안내 문구 */
    sendFeedback: async (o: { workId: string; n: number; sentence: Sentence; type: FeedbackType; text: string; storyCheck: boolean }) => {
      const text = o.text.trim()
      if (!text) return toast('내용을 입력해 주세요'), null
      const verified = o.type === '스토리 오류' && o.storyCheck && window.confirm('스토리 오류 검증을 시연할까요? 비용과 한도는 미정이며 실제 AI 호출이나 차감은 없습니다.')
      return feedbackUseCase.sendFeedback({ workId: o.workId, n: o.n, sentence: o.sentence, type: o.type, text, verified, nick })
    },
    reportWork: async (workId: string, type: string, text: string) => {
      const v = text.trim()
      if (!v) return toast('신고 내용을 입력해 주세요'), null
      return feedbackUseCase.reportWork({ workId, type, text: v, nick })
    },
  }
}
