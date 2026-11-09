import { useContext, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { SessionExpired } from '../../../../domain/repositories/ProfileRepository'
import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { checkProfile } from '../../../../domain/entities/account'
import { OperationsError } from '../../../../domain/entities/operations'
import type { AccountUseCase } from '../../../../domain/usecases/AccountUseCase'
import type { NoticeUseCase } from '../../../../domain/usecases/NoticeUseCase'
import type { SupportInquiryUseCase } from '../../../../domain/usecases/SupportInquiryUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { RestoreContext } from '../../../shared/session/restoreContext'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 mePage(sub)·saveProfile·#suf·withdrawSheet와 실제 고객지원 문의(#iqf)·운영 공지: U30~U35E 계정 */
export function useAccountViewModel(
  sub: string,
  accountUseCase: AccountUseCase = appContainer.resolve('accountUseCase'),
  supportInquiryUseCase: SupportInquiryUseCase = appContainer.resolve('supportInquiryUseCase'),
  noticeUseCase: NoticeUseCase = appContainer.resolve('noticeUseCase'),
) {
  const { role, user } = useAppSelector((s) => s.session)
  const restoring = useContext(RestoreContext)
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
    events: sub === 'event' ? await accountUseCase.events() : [],
    notices: sub === 'notice' && noticeId === null ? await noticeUseCase.listPublic() : [],
    notice: sub === 'notice' && noticeId ? await noticeUseCase.getPublic(noticeId) : null,
  }), [accountUseCase, noticeUseCase, sub, noticeId])
  // 내 문의: 로그인한 회원의 문의하기 화면에서만 실제 목록을 읽습니다. 로딩·실패·빈 목록은 화면이 구분합니다.
  const mine = useAsyncData(async () => sub === 'inquiry' && role ? supportInquiryUseCase.listMine() : [], [supportInquiryUseCase, sub])
  return {
    role, user, profileState, saving, pendingEmail, profileError, profileErrors, profileNotice, asking, inquiry, mine, restoring, data: data?.sub === sub ? data : undefined,
    loadFailed: isError, retryLoad: retry,
    /** 로그인 후 문의하기로 돌아오도록 안내를 남깁니다. 이동은 로그인 링크가 맡습니다. */
    requireLogin: () => { dispatch(sessionActions.requireLogin({ next: '/me/inquiry', msg: '문의는 로그인한 회원만 보낼 수 있어요.', role: 'user' })) },
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
    /** 실제 접수. 성공했을 때만 true이며, 실패하면 입력을 그대로 두고 이유를 안내합니다. */
    ask: async (category: string, title: string, body: string) => {
      if (askBusy.current) return false
      askBusy.current = true
      setAsking(true)
      setInquiry(null)
      try {
        await supportInquiryUseCase.create({ category, title, body })
        const r = { ok: true, msg: '문의를 보냈어요' }
        setInquiry(r)
        toast(r.msg)
        dispatch(sessionActions.dataChanged())
        return true
      } catch (error) {
        // 서버 응답이 없거나 늦은 경우는 접수 여부를 알 수 없으므로 목록 확인을 안내합니다.
        const r = { ok: false, msg: error instanceof OperationsError ? error.message : '문의를 보냈는지 확인하지 못했어요. 입력은 그대로 두었어요. 아래 내 문의를 확인한 뒤 다시 시도해 주세요.' }
        setInquiry(r)
        toast(r.msg)
        return false
      } finally { askBusy.current = false; setAsking(false) }
    },
  }
}
