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

/** 목업 chatPage()·bindChat(): 질문을 남기고 0.45초 뒤 인물의 답을 붙입니다 (고정 데모 응답). */
export function useChatViewModel(wid: string, cn: string | undefined, chatUseCase: ChatUseCase = appContainer.resolve('chatUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const dispatch = useAppDispatch()
  useScreenId('U27')
  const { data } = useAsyncData(() => chatUseCase.page(wid, cn), [chatUseCase, wid, cn])
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const ask = async (input: { q: number } | { text: string }) => {
    const cur = data?.cur
    if (!data || !cur) return
    if ('text' in input && !input.text.trim()) return toast('물어볼 내용을 입력해 주세요')
    const r = await chatUseCase.answer(wid, cur.n, input, role)
    if (!r) return
    await chatUseCase.append(data.key, ['나', r.question])
    dispatch(sessionActions.dataChanged())
    timer.current = window.setTimeout(async () => { await chatUseCase.append(data.key, [cur.n, ...r.reply]); dispatch(sessionActions.dataChanged()) }, 450)
  }
  return { data, ask }
}
