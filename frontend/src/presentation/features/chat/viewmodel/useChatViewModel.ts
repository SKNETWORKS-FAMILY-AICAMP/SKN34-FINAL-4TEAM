import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import type { ChatLine } from '../../../../domain/entities/chat'
import type { ChatFilter, ChatUseCase } from '../../../../domain/usecases/ChatUseCase'
import { toast } from '../../../shared/events'
import { qs } from '../../../shared/format'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 chatListPage()·bindChatList(): U27 캐릭터챗 목록 */
export function useChatListViewModel(f: ChatFilter, chatUseCase: ChatUseCase = appContainer.resolve('chatUseCase')) {
  const navigate = useNavigate()
  useScreenId('U27')
  // 필터는 조회 범위가 아니라 같은 목록 안의 화면 선택이다(refresh). 범위로 두면 고를 때마다 목록이 사라져 조작하던 select와 초점을 잃는다.
  const key = [f.kind, f.work, f.character, f.sort].join('|')
  const { data, isError, retry } = useAsyncData(async () => ({ key, ...await chatUseCase.list(f) }), [chatUseCase], [key])
  // 다시 읽는 동안에는 방금 고른 주소의 값을 보인다. 이전 응답의 st를 쓰면 select가 옛 값으로 되돌아갔다 바뀐다.
  const st = data?.key === key ? data.st : f
  return {
    data, st, isError, retry,
    to: (patch: Partial<ChatFilter>) => qs('/chat', { ...st, ...patch }),
    go: (patch: Partial<ChatFilter>) => navigate(qs('/chat', { ...st, ...patch })),
  }
}

/** 답을 기다리던 질문이 취소되면 인물 대화에 남기는 안내: [내용, 근거] (고정 문구) */
const CANCELED: [string, string] = ['대화를 나가서 이 질문의 답변이 취소됐어요. 다시 물어봐 주세요.', '답변 취소']
const EMPTY_QUESTION = '물어볼 내용을 입력해 주세요'

/** 목업 chatPage()·bindChat(): 질문을 남기고 0.45초 뒤 인물의 답을 붙입니다 (고정 데모 응답). */
export function useChatViewModel(wid: string, cn: string | undefined, chatUseCase: ChatUseCase = appContainer.resolve('chatUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  useScreenId('U27')
  const { data: page, isError, retry } = useAsyncData(() => chatUseCase.page(wid, cn), [chatUseCase, wid, cn])
  // 질문·답은 저장소에 남긴 뒤 화면 기록에만 덧붙인다. 대화방 조회는 작품 목록까지 다시 읽으므로 한 줄마다 부르지 않는다.
  // 덧붙인 줄은 그 줄을 얹은 조회 결과(of)에만 속한다. 다시 읽으면 저장소 기록에 이미 들어 있어 버린다.
  const [added, setAdded] = useState<{ of: unknown; lines: ChatLine[] }>({ of: null, lines: [] })
  const [askError, setAskError] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const sending = useRef<object | null>(null)
  // 대화 상대가 바뀌거나 화면을 떠나면 보내는 중인 질문과 기다리던 답을 취소합니다. 답을 기다리던 질문에는 취소 안내를 남겨 답 없는 질문으로 보이지 않게 합니다.
  const key = page?.key, who = page?.cur?.n
  useEffect(() => () => {
    if (key && who && timer.current !== undefined) void chatUseCase.append(key, [who, ...CANCELED])
    window.clearTimeout(timer.current); timer.current = undefined; sending.current = null
  }, [chatUseCase, key, who])
  /** 질문을 남겼으면 true. 받아들이지 않았으면 false라서 화면은 입력한 글을 지우지 않습니다. */
  const ask = async (input: { q: number } | { text: string }) => {
    const cur = page?.cur
    // 질문을 남기는 중이거나 답을 기다리는 동안(timer가 있는 동안)에는 다시 보내지 않습니다.
    if (!page || !cur || sending.current || timer.current !== undefined) return false
    if ('text' in input && !input.text.trim()) { setAskError(EMPTY_QUESTION); toast(EMPTY_QUESTION); return false }
    setAskError('')
    const req = {}
    sending.current = req
    const show = async (line: ChatLine) => {
      await chatUseCase.append(page.key, line)
      setAdded((x) => ({ of: page, lines: x.of === page ? [...x.lines, line] : [line] }))
    }
    try {
      const r = await chatUseCase.answer(wid, cur.n, input, role)
      if (!r || sending.current !== req) return false // 기다리는 사이 대화가 바뀌거나 화면을 떠났으면 늦게 온 결과를 버립니다.
      await show(['나', r.question])
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        void show([cur.n, ...r.reply])
      }, 450)
      return true
    } finally { if (sending.current === req) sending.current = null }
  }
  const data = page && added.of === page && added.lines.length ? { ...page, log: [...page.log, ...added.lines] } : page
  return { data, isError, retry, askError, ask }
}
