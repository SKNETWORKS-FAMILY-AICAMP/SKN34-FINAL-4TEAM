import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { isPub } from '../../../../domain/entities/work'
import type { FeedbackUseCase } from '../../../../domain/usecases/FeedbackUseCase'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { toast } from '../../../shared/events'
import { usePublicImageAlts } from '../../../shared/media/usePublicImageAlts'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { uiActions } from '../../../shared/ui/uiSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useLook } from './useLook'

const LOOK_VARS = {
  white: { '--tbg': '#FFFFFF', '--tfg': '#1F2024', '--tsub': '#6B6F78', '--tline': '#ECECEC', '--tcard': '#FAFAFA', '--tacc': '#6D4AE0', '--tbtn': '#6D4AE0', '--tbtnfg': '#fff', colorScheme: 'light' },
  night: { '--tbg': '#0E0E10', '--tfg': '#D9D9DE', '--tsub': '#8C8E97', '--tline': '#25252B', '--tcard': '#18181C', '--tacc': '#9D87FF', '--tbtn': '#9D87FF', '--tbtnfg': '#140E2B', colorScheme: 'dark' },
} as const

type ReaderSheet = { kind: 'comment' | 'feedback' | 'suggest'; k: number } | { kind: 'look' } | null

/** 비회원이 회원 전용 동작을 누를 때 로그인 화면에 보여 줄 안내 */
const MEMBER_ONLY = {
  comment: '댓글은 로그인한 회원만 남길 수 있어요.',
  feedback: '피드백은 로그인한 회원만 보낼 수 있어요.',
  suggest: '수정 제안은 로그인한 회원만 보낼 수 있어요.',
  like: '댓글 좋아요는 로그인한 회원만 누를 수 있어요.',
}

/** 목업 reader(id,n)·bindReader: 회차 뷰어 U05·U08 */
export function useReaderViewModel(id: string, n: number,
  readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase'),
  feedbackUseCase: FeedbackUseCase = appContainer.resolve('feedbackUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const look = useLook()
  /** 회원 전용 동작(댓글·피드백·댓글 좋아요)의 입구. 비회원이면 포크처럼 로그인 화면으로 보내고(안내와 돌아올 회차를 남김) false를 돌려준다. */
  const requireMember = (what: keyof typeof MEMBER_ONLY) => {
    if (role) return true
    dispatch(sessionActions.requireLogin({ next: `/read/${id}/${n}`, msg: MEMBER_ONLY[what], role: 'user' }))
    navigate('/login')
    return false
  }
  const { data, isError, retry } = useAsyncData(async () => {
    const r = await readingUseCase.openEpisode(id, n, role)
    if (!r || r === 'hidden') return r
    // 독서 기록 저장은 기다리지 않는다. 실패해도 읽기는 계속되지만, 저장된 것처럼 보이지 않게 알립니다.
    r.recording.catch(() => toast('이어 읽기 위치를 저장하지 못했어요 · 읽기는 계속할 수 있어요'))
    return { ...r, ...(await feedbackUseCase.getComments(r.work, r.n)) }
  }, [readingUseCase, feedbackUseCase, id, n, role])
  const [selected, setSelected] = useState<{ k: number; top: number; left: number; pop: boolean } | null>(null)
  const [sheet, setSheet] = useState<ReaderSheet>(null)
  // 키보드 탭 정지점(roving tabindex): 본문은 문장 하나만 Tab 순서에 두고 방향키로 옮깁니다.
  const [tabStop, setTabStop] = useState(0)
  // 목업 render(): 다른 회차로 옮기면 문장 팝업과 선택을 지우고, 열린 문장 시트도 닫습니다(이전 회차의 문장 번호가 남지 않게).
  const [shown, setShown] = useState(id + '/' + n)
  if (shown !== id + '/' + n) { setShown(id + '/' + n); setSelected(null); setSheet(null); setTabStop(0) }
  const ok = data && data !== 'hidden' ? data : null
  const setEnd = useCallback((end: boolean) => { dispatch(uiActions.setBaseScreen(end ? 'U08' : 'U05')) }, [dispatch])
  useScreenId(ok ? 'U05' : null)

  const sentences = ok ? ok.paragraphs.flat() : []
  // 본문 이미지는 독자가 받는 것과 같은 길로 받는다: 공개 작품은 로그인 없이 읽는 공개 경로와 공개 대체 텍스트, 작가만 여는 비공개 작품은 소유자 경로다.
  const publicImages = !!ok && isPub(ok.work)
  const imageAlts = usePublicImageAlts(ok?.work.id ?? '', ok?.n ?? 0, publicImages && ok.blocks.some((b) => b.kind === 'image'))
  const theme = ok?.work.theme ?? 'hanji'
  const lite = !look.dark
  return {
    /** undefined: 불러오는 중, null: 볼 수 없는 작품, 'hidden': 숨긴 회차 */
    state: data, isError, retry,
    reader: ok,
    /** 고를 수 있는 문장. 순서가 reader.blocks의 문장 순서(화면의 data-s)와 같다. */
    sentences,
    /** 본문 이미지를 공개 경로로 받을지와, 공개 작품 발행본 이미지의 대체 텍스트(이미지 ID → 설명, 못 읽으면 빈 값) */
    publicImages,
    imageAlts,
    readerClass: (look.eff === 'world' ? `th-${theme} themed${lite ? ' lite' : ''}` : `calm rd calm-${theme}`) + ' reader',
    readerVars: { ...(look.eff === 'white' || look.eff === 'night' ? LOOK_VARS[look.eff] : {}), '--fs': look.fs + 'px' },
    amb: look.eff === 'world' && look.motion ? { lite } : null,
    tabStop,
    setTabStop,
    selected,
    /** 목업 selectSent(): 고른 문장과 팝업(댓글·피드백·공유) 위치 */
    select: (s: { k: number; top: number; left: number } | null) => setSelected(s && { ...s, pop: true }),
    sheet,
    /** 시트를 열면 목업처럼 문장 팝업을 닫고 선택 표시는 남깁니다. */
    openSheet: (s: ReaderSheet) => {
      if (s && s.kind !== 'look' && !requireMember(s.kind)) return
      setSelected((x) => x && { ...x, pop: false })
      setSheet(s)
    },
    requireMember,
    /** 로그인한 회원인가. 실제 작품 문장 팝업이 비로그인에게 댓글·피드백·수정 제안을 ‘로그인하고 …’로 보이는 데 쓴다. */
    loggedIn: !!role,
    closeSheet: () => setSheet(null),
    share: () => toast('링크 공유는 데모예요 (실제 복사 없음)'),
    shareSentence: () => toast('문장 공유는 데모예요 (실제 복사 없음)'),
    setEnd,
    toggleCommentLike: async (key: string) => {
      if (!ok || !requireMember('like')) return
      try { await feedbackUseCase.toggleCommentLike(ok.work.id,key); dispatch(sessionActions.dataChanged()) }
      catch (error) { toast(error instanceof Error?error.message:'댓글 좋아요를 저장하지 못했어요.') }
    },
  }
}
