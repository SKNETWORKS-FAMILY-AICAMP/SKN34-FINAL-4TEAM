import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import { checkSignup, EMAIL } from '../../../../domain/entities/account'

export function useSignupViewModel() {
  const useCase = appContainer.resolve('signupUseCase')
  const busy = useRef(false)
  const active = useRef(true)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<{ email?: string; nick?: string; p1?: string; p2?: string }>({})
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const run = async (action: () => Promise<void>, success: string) => {
    if (busy.current) return false
    busy.current = true
    setPending(true)
    setMessage('')
    setError('')
    setErrors({})
    try {
      await action()
      if (!active.current) return false
      setMessage(success)
      return true
    } catch {
      if (active.current) setError('요청을 처리하지 못했어요. 입력을 확인하고 다시 시도해 주세요.')
      return false
    } finally { busy.current = false; if (active.current) setPending(false) }
  }
  return {
    pending, message, error, errors, submittedEmail,
    signup: async (input: { email: string; nick: string; p1: string; p2: string }) => {
      if (busy.current || submittedEmail) return false
      const issue = checkSignup(input)
      if (issue) { setErrors({ [issue.field]: issue.message }); setError(''); setMessage(''); return false }
      const email = input.email.trim()
      const ok = await run(() => useCase.signup({ email, nickname: input.nick.trim(), password: input.p1 }), '가입 요청을 받았어요. 확인 메일을 확인해 주세요.')
      if (ok) setSubmittedEmail(email)
      return ok
    },
    resend: async (email: string) => {
      if (busy.current || submittedEmail) return false
      if (!EMAIL.test(email.trim())) { setErrors({ email: '이메일 형식을 확인해 주세요' }); setError(''); setMessage(''); return false }
      const ok = await run(() => useCase.resendVerification(email.trim()), '요청을 받았어요. 해당 계정이 있으면 확인 메일이 발송됩니다.')
      if (ok) setSubmittedEmail(email.trim())
      return ok
    },
    startOver: () => { if (!busy.current) { setSubmittedEmail(null); setMessage(''); setError(''); setErrors({}) } },
  }
}

export function useVerifyEmailViewModel(change = false) {
  const signedIn = useAppSelector((state) => state.session.role !== null)
  const started = useRef(false)
  const active = useRef(true)
  const [result, setResult] = useState<{ state: 'pending' | 'success' | 'error'; message: string }>({
    state: 'pending', message: change ? '이메일 변경을 확인하고 있어요.' : '이메일을 확인하고 있어요.',
  })
  useEffect(() => {
    active.current = true
    if (!started.current) {
      started.current = true
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      if (!token) setResult({ state: 'error', message: change ? '인증 링크가 올바르지 않아요.' : '인증 링크가 올바르지 않아요. 확인 메일을 다시 요청해 주세요.' })
      else {
        const request = change ? appContainer.resolve('profileUseCase').verifyEmailChange(token) : appContainer.resolve('signupUseCase').verifyEmail(token)
        void request.then(
          () => { if (active.current) setResult({ state: 'success', message: change ? '이메일 변경이 완료됐어요.' : '이메일 인증이 완료됐어요. 로그인해 주세요.' }) },
          () => { if (active.current) setResult({ state: 'error', message: change ? '이메일을 변경하지 못했어요. 링크가 만료됐거나 이미 사용됐을 수 있어요.' : '이메일을 인증하지 못했어요. 링크가 만료됐거나 이미 사용됐을 수 있어요. 확인 메일을 다시 요청해 주세요.' }) },
        )
      }
    }
    return () => { active.current = false }
  }, [change])
  return { ...result, signedIn }
}
