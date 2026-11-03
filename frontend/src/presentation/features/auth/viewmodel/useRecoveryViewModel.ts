import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import { checkPassword, EMAIL } from '../../../../domain/entities/account'
import { InvalidResetLink } from '../../../../domain/repositories/AuthRepository'

type FieldErrors = { email?: string; password?: string; confirmation?: string }

export function useRecoveryViewModel(reset: boolean) {
  const auth = appContainer.resolve('authUseCase')
  const token = useRef<string | null>(null)
  const mode = useRef<boolean | null>(null)
  const busy = useRef(false)
  const active = useRef(true)
  const requestId = useRef(0)
  const [pending, setPending] = useState(false)
  const [state, setState] = useState<'ready' | 'invalid' | 'success'>('ready')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')
  useEffect(() => {
    active.current = true
    ++requestId.current
    if (mode.current !== reset) {
      mode.current = reset
      token.current = reset ? new URLSearchParams(window.location.hash.slice(1)).get('token') : null
      if (reset) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      busy.current = false
      setPending(false)
      setErrors({})
      setMessage('')
      setSubmittedEmail('')
      setState(reset && !token.current ? 'invalid' : 'ready')
      setError(reset && !token.current ? '재설정 링크가 올바르지 않아요. 새 링크를 요청해 주세요.' : '')
    }
    return () => { active.current = false }
  }, [reset])
  async function submit(email: string, password: string, confirmation: string) {
    if (busy.current || state !== 'ready') return
    const fieldErrors: FieldErrors = reset
      ? { password: checkPassword(password) ?? undefined, confirmation: password !== confirmation ? '비밀번호가 서로 달라요' : undefined }
      : { email: !EMAIL.test(email.trim()) ? '이메일 형식을 확인해 주세요.' : undefined }
    setErrors(fieldErrors)
    setError('')
    setMessage('')
    if (Object.values(fieldErrors).some(Boolean)) return
    const currentToken = token.current
    if (reset && !currentToken) { setState('invalid'); setError('재설정 링크가 올바르지 않아요. 새 링크를 요청해 주세요.'); return }
    const id = ++requestId.current
    busy.current = true; setPending(true)
    try {
      if (reset && currentToken) await auth.resetPassword(currentToken, password)
      else await auth.forgotPassword(email.trim())
      if (!active.current || id !== requestId.current) return
      token.current = null
      setState('success')
      if (!reset) setSubmittedEmail(email.trim())
      setMessage(reset ? '비밀번호를 변경했어요. 로그인해 주세요.' : '요청을 받았어요. 해당 계정이 있으면 재설정 메일이 발송됩니다.')
    } catch (cause) {
      if (!active.current || id !== requestId.current) return
      if (reset && cause instanceof InvalidResetLink) {
        token.current = null
        setState('invalid')
        setError('비밀번호를 변경하지 못했어요. 링크가 만료됐거나 이미 사용됐을 수 있어요. 새 링크를 요청해 주세요.')
      } else setError(reset ? '비밀번호를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.' : '요청을 처리하지 못했어요. 다시 시도해 주세요.')
    } finally {
      if (id === requestId.current) { busy.current = false; if (active.current) setPending(false) }
    }
  }
  return { pending, state, errors, error, message, submittedEmail, submit,
    startOver: () => { if (!reset && !busy.current) { setState('ready'); setMessage(''); setError(''); setErrors({}) } },
  }
}
