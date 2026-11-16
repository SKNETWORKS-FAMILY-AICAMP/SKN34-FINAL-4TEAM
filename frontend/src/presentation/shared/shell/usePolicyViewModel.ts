import { useEffect, useState } from 'react'

import { appContainer } from '../../../app/appContainer'
import { useAppDispatch } from '../../../app/store'
import type { CreditUseCase } from '../../../domain/usecases/CreditUseCase'
import { sessionActions } from '../session/sessionSlice'
import { useAsyncData } from '../useAsyncData'

/** 목업 policySheet(): 결제 내역(/me/pay)의 '정책 안내' 버튼(sf-policy 이벤트)으로 엽니다. */
export function usePolicyViewModel(creditUseCase: CreditUseCase = appContainer.resolve('creditUseCase')) {
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(false)
  const { data } = useAsyncData(() => (open ? creditUseCase.state() : Promise.resolve(undefined)), [creditUseCase, open])
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('sf-policy', show)
    return () => window.removeEventListener('sf-policy', show)
  }, [])
  return {
    open, data,
    close: () => setOpen(false),
    setFailNext: async (v: boolean) => { await creditUseCase.setFailNext(v); dispatch(sessionActions.dataChanged()) },
  }
}
