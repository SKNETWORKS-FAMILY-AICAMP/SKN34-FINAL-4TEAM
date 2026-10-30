import { useLocation, useNavigate, useSearchParams } from 'react-router'

import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'

/**
 * 목업 writingPolicy()·writingPolicyForm: 포크·가져오기 전 정책과 저작권 동의(U43).
 * 목업 forkPolicyTarget은 이동 state로 받아 정책 화면을 떠나면 자연히 사라집니다.
 */
export function useWritingPolicyViewModel() {
  const [q] = useSearchParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const raw = q.get('method')
  const method: 'fork' | 'import' | null = raw === 'fork' || raw === 'import' ? raw : null
  useScreenId(method ? 'U43' : null)
  const target = typeof state?.target === 'string' ? state.target : null
  return {
    method,
    submit: (rule: boolean, rights: boolean) => {
      if (!rule || !rights) return toast('정책과 저작권 안내에 모두 동의해 주세요')
      navigate(method === 'fork' ? target || '/rank?t=orig' : '/import')
    },
  }
}
