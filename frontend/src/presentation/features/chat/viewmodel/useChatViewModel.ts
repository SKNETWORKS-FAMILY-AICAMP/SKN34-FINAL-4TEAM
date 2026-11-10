import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { ChatFilter, ChatUseCase } from '../../../../domain/usecases/ChatUseCase'
import { toast } from '../../../shared/events'
import { qs } from '../../../shared/format'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 chatListPage()·bindChatList(): U27 캐릭터챗 목록 */
export function useChatListViewModel(f: ChatFilter, chatUseCase: ChatUseCase = appContainer.resolve('chatUseCase')) {
  const navigate = useNavigate()
  useScreenId('U27')
  const { data } = useAsyncData(() => chatUseCase.list(f), [chatUseCase, f.kind, f.work, f.character, f.sort])
  return {
    data,
    to: (patch: Partial<ChatFilter>) => qs('/chat', { ...(data?.st ?? f), ...patch }),
    go: (patch: Partial<ChatFilter>) => navigate(qs('/chat', { ...(data?.st ?? f), ...patch })),
  }
}

/** 답을 기다리던 질문이 취소되면 인물 대화에 남기는 안내: [내용, 근거] (고정 문구) */
const CANCELED: [string, string] = ['대화를 나가서 이 질문의 답변이 취소됐어요. 다시 물어봐 주세요.', '답변 취소']

/** 목업 chatPage()·bindChat(): 질문을 남기고 0.45초 뒤 인물의 답을 붙입니다 (고정 데모 응답). */
export function useChatViewModel(wid: string, cn: string | undefined, chatUseCase: ChatUseCase = appContainer.resolve('chatUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const dispatch = useAppDispatch()
  useScreenId('U27')
  const { data } = useAsyncData(() => chatUseCase.page(wid, cn), [chatUseCase, wid, cn])
  const timer = useRef<number | undefined>(undefined)
  const sending = useRef<object | null>(null)
  // 대화 상대가 바뀌거나 화면을 떠나면 보내는 중인 질문과 기다리던 답을 취소합니다. 답을 기다리던 질문에는 취소 안내를 남겨 답 없는 질문으로 보이지 않게 합니다.
  useEffect(() => {
    const key = data?.key, who = data?.cur?.n
    return () => {
      if (key && who && timer.current !== undefined) void chatUseCase.append(key, [who, ...CANCELED])
      window.clearTimeout(timer.current); timer.current = undefined; sending.current = null
    }
  }, [data?.key])
  /** 질문을 남겼으면 true. 받아들이지 않았으면 false라서 화면은 입력한 글을 지우지 않습니다. */
  const ask = async (input: { q: number } | { text: string }) => {
    const cur = data?.cur
    // 질문을 남기는 중이거나 답을 기다리는 동안(timer가 있는 동안)에는 다시 보내지 않습니다.
    if (!data || !cur || sending.current || timer.current !== undefined) return false
    if ('text' in input && !input.text.trim()) { toast('물어볼 내용을 입력해 주세요'); return false }
    const req = {}
    sending.current = req
    try {
      const r = await chatUseCase.answer(wid, cur.n, input, role)
      if (!r || sending.current !== req) return false // 기다리는 사이 대화가 바뀌거나 화면을 떠났으면 늦게 온 결과를 버립니다.
      await chatUseCase.append(data.key, ['나', r.question])
      dispatch(sessionActions.dataChanged())
      timer.current = window.setTimeout(async () => {
        timer.current = undefined
        await chatUseCase.append(data.key, [cur.n, ...r.reply])
        dispatch(sessionActions.dataChanged())
      }, 450)
      return true
    } finally { if (sending.current === req) sending.current = null }
  }
  return { data, ask }
}
