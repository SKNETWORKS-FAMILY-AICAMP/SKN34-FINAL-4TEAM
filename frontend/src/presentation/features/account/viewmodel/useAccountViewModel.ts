import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { checkProfile } from '../../../../domain/entities/account'
import type { AccountUseCase } from '../../../../domain/usecases/AccountUseCase'
import type { NoticeUseCase } from '../../../../domain/usecases/NoticeUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 mePage(sub)·saveProfile·#suf·#iqf·withdrawSheet: U30~U35E 계정 */
export function useAccountViewModel(sub: string, accountUseCase: AccountUseCase = appContainer.resolve('accountUseCase'), noticeUseCase: NoticeUseCase = appContainer.resolve('noticeUseCase')) {
  const { role, user } = useAppSelector((s) => s.session)
  const dispatch = useAppDispatch()
  const profileUseCase = appContainer.resolve('profileUseCase')
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [profileAttempt, setProfileAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileErrors, setProfileErrors] = useState<{ nick?: string; email?: string }>({})
  const [profileNotice, setProfileNotice] = useState('')
  const [asking, setAsking] = useState(false)
  const [inquiry, setInquiry] = useState<{ ok: boolean; msg: string } | null>(null)
  const busy = useRef(false)
  const askBusy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    if (sub !== 'profile' || !role) return
    const request = new AbortController()
    controller.current = request
    setProfileState('loading')
    profileUseCase.get(request.signal).then((profile) => {
      if (request.signal.aborted) return
      dispatch(sessionActions.setUser({ nick: profile.nickname, email: profile.email }))
      setProfileState('ready')
    }).catch((error: unknown) => {
      if (request.signal.aborted) return
      if (error instanceof SessionExpired) { dispatch(sessionActions.logout()); toast('세션이 만료됐어요. 다시 로그인해 주세요.') }
      else setProfileState('error')
    })
    return () => { request.abort(); controller.current = null }
  }, [sub, role, dispatch, profileUseCase, profileAttempt])
  useScreenId(sub === 'liked' ? 'U32' : sub === 'pay' ? 'U33' : sub === 'inquiry' ? 'U34' : sub === 'notice' ? 'U35' : sub === 'event' ? 'U35E' : 'U30')
  // 공지는 인증 없는 운영 공지 API: ?id가 없으면 목록, 있으면 그 공지 하나(없으면 null)를 읽습니다. id는 조회 범위라 바뀌면 이전 결과를 감춥니다.
  const [params] = useSearchParams()
  const noticeId = sub === 'notice' ? params.get('id') : null
  const { data, isError, retry } = useAsyncData(async () => ({
    sub,
    liked: sub === 'liked' ? await accountUseCase.liked() : [],
    storage: sub === 'storage' ? await accountUseCase.storage() : null,
    inquiries: sub === 'inquiry' ? await accountUseCase.inquiries() : [],
    events: sub === 'event' ? await accountUseCase.events() : [],
    notices: sub === 'notice' && noticeId === null ? await noticeUseCase.listPublic() : [],
    notice: sub === 'notice' && noticeId ? await noticeUseCase.getPublic(noticeId) : null,
  }), [accountUseCase, noticeUseCase, sub, noticeId])
  return {
    role, user, profileState, saving, pendingEmail, profileError, profileErrors, profileNotice, asking, inquiry, data: data?.sub === sub ? data : undefined,
    loadFailed: isError, retryLoad: retry,
    retryProfile: () => setProfileAttempt((attempt) => attempt + 1),
    saveProfile: async (nick: string, email: string) => {
      const err = checkProfile(nick, email)
      // checkProfile은 첫 오류만 돌려줍니다. 이메일을 올바른 값으로 바꿔도 오류가 남으면 닉네임이 문제인 겁니다.
      setProfileErrors(err ? { [checkProfile(nick, 'a@a.aa') ? 'nick' : 'email']: err } : {})
      if (err) { toast(err); return }
      if (busy.current || !controller.current) return
      const signal = controller.current.signal
      const session = profileUseCase.sessionKey()
      busy.current = true
      setSaving(true)
      setProfileError('')
      setProfileNotice('')
      let nicknameSaved = false
      try {
        if (nick.trim() !== user.nick) {
          const profile = await profileUseCase.update(nick.trim(), signal, session)
          if (signal.aborted) return
          dispatch(sessionActions.setUser({ nick: profile.nickname, email: profile.email }))
          nicknameSaved = true
        }
        if (email.trim() !== user.email) {
          await profileUseCase.requestEmailChange(email.trim(), signal, session)
          if (signal.aborted) return
          setPendingEmail(email.trim())
          toast('확인 메일을 보냈어요. 인증 전에는 기존 이메일이 유지돼요.')
        } else { setProfileNotice('프로필을 저장했어요'); toast('프로필을 저장했어요') }
        return true
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof SessionExpired) { dispatch(sessionActions.logout()); toast('세션이 만료됐어요. 다시 로그인해 주세요.') }
        else {
          const message = nicknameSaved ? '닉네임은 저장했지만 이메일 변경 메일을 요청하지 못했어요. 다시 시도해 주세요.' : '요청을 완료하지 못했어요. 입력을 확인한 뒤 다시 시도해 주세요.'
          setProfileError(message)
          toast(message)
        }
      } finally { busy.current = false; if (!signal.aborted) setSaving(false) }
    },
    ask: async (t: string, s: string, b: string) => {
      if (askBusy.current) return false
      askBusy.current = true
      setAsking(true)
      setInquiry(null)
      try {
        const r = await accountUseCase.ask(t, s, b)
        setInquiry(r)
        toast(r.msg)
        if (r.ok) dispatch(sessionActions.dataChanged())
        return r.ok
      } finally { askBusy.current = false; setAsking(false) }
    },
  }
}
