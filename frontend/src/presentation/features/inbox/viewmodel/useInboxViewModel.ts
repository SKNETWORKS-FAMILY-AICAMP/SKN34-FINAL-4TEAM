import { useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch } from '../../../../app/store'
import type { InboxAct, InboxUseCase } from '../../../../domain/usecases/InboxUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 inbox(): U20 독자 피드백함 */
export function useInboxViewModel(sel: string | null, inboxUseCase: InboxUseCase = appContainer.resolve('inboxUseCase')) {
  const dispatch = useAppDispatch()
  useScreenId('U20')
  // 고른 항목(sel)은 조회 범위가 아니라 같은 목록 안의 화면 선택이다(refresh). 범위로 두면 고를 때마다 목록이 비어 초점과 화면 아래쪽 입력을 잃는다.
  const { data, isError, retry } = useAsyncData(() => inboxUseCase.list(sel), [inboxUseCase], [sel])
  const [pending, setPending] = useState(false)
  /** 처리 결과 안내. 어느 항목의 결과인지 함께 보관해 다른 항목을 열면 보이지 않게 합니다. */
  const [notice, setNotice] = useState<{ id: string; msg: string } | null>(null)
  const busy = useRef(false)
  return {
    data, isError, retry, pending, notice,
    act: async (id: string, act: InboxAct, answer?: string) => {
      if (busy.current) return
      busy.current = true
      setPending(true)
      setNotice(null)
      try {
        const msg = await inboxUseCase.act(id, act, answer)
        if (!msg) return
        dispatch(sessionActions.dataChanged())
        setNotice({ id, msg })
        toast(msg)
      } finally { busy.current = false; setPending(false) }
    },
  }
}
