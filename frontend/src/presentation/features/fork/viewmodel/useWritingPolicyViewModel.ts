import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { toast } from '../../../shared/events'
import { qs } from '../../../shared/format'
import { useScreenId } from '../../../shared/screenIds'

/**
 * 목업 writingPolicy()·writingPolicyForm: 포크·가져오기 전 정책과 저작권 동의(U43).
 * 로그인 복귀 주소에서 원작·기준 회차를 한 번 읽고, 정책 화면을 열면 주소에서 소비합니다.
 */
export function useWritingPolicyViewModel() {
  const [q, setQuery] = useSearchParams()
  const navigate = useNavigate()
  const raw = q.get('method')
  const method: 'fork' | 'import' | null = raw === 'fork' || raw === 'import' ? raw : null
  useScreenId(method ? 'U43' : null)
  const work = q.get('work')
  const at = q.get('at')
  const [target] = useState(() => {
    if (method !== 'fork' || !work || !/^[a-z0-9_-]+$/i.test(work)) return null
    const episode = Number(at)
    return qs(`/fork/${work}`, { at: Number.isSafeInteger(episode) && episode > 0 ? String(episode) : undefined })
  })
  useEffect(() => {
    if (method !== 'fork' || (work === null && at === null)) return
    setQuery((current) => {
      const remaining = new URLSearchParams(current)
      remaining.delete('work')
      remaining.delete('at')
      return remaining
    }, { replace: true })
  }, [method, work, at, setQuery])
  return {
    method,
    submit: (rule: boolean, rights: boolean) => {
      if (!rule || !rights) return toast('정책과 저작권 안내에 모두 동의해 주세요')
      navigate(method === 'fork' ? target || '/rank?t=orig' : '/import')
    },
  }
}
