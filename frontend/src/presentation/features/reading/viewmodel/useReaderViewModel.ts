import { useCallback, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { FeedbackUseCase } from '../../../../domain/usecases/FeedbackUseCase'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useLook } from './useLook'

const LOOK_VARS = {
  white: { '--tbg': '#FFFFFF', '--tfg': '#1F2024', '--tsub': '#6B6F78', '--tline': '#ECECEC', '--tcard': '#FAFAFA', '--tacc': '#6D4AE0', '--tbtn': '#6D4AE0', '--tbtnfg': '#fff', colorScheme: 'light' },
  night: { '--tbg': '#0E0E10', '--tfg': '#D9D9DE', '--tsub': '#8C8E97', '--tline': '#25252B', '--tcard': '#18181C', '--tacc': '#9D87FF', '--tbtn': '#9D87FF', '--tbtnfg': '#140E2B', colorScheme: 'dark' },
} as const

type ReaderSheet = { kind: 'comment' | 'feedback'; k: number } | { kind: 'look' } | null

/** 목업 reader(id,n)·bindReader: 회차 뷰어 U05·U08 */
export function useReaderViewModel(id: string, n: number,
  readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase'),
  feedbackUseCase: FeedbackUseCase = appContainer.resolve('feedbackUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const dispatch = useAppDispatch()
  const look = useLook()
  const { data } = useAsyncData(async () => {
    const r = await readingUseCase.openEpisode(id, n, role)
    if (!r || r === 'hidden') return r
    return { ...r, ...(await feedbackUseCase.getComments(r.work, r.n)) }
  }, [readingUseCase, feedbackUseCase, id, n, role])
  const [selected, setSelected] = useState<{ k: number; top: number; left: number; pop: boolean } | null>(null)
  const [sheet, setSheet] = useState<ReaderSheet>(null)
  const ok = data && data !== 'hidden' ? data : null
  const setEnd = useCallback((end: boolean) => { dispatch(sessionActions.setBaseScreen(end ? 'U08' : 'U05')) }, [dispatch])
  useScreenId(ok ? 'U05' : null)

  const sentences = ok ? ok.paragraphs.flat() : []
  const theme = ok?.work.theme ?? 'hanji'
  const lite = !look.dark
  return {
    /** undefined: 불러오는 중, null: 볼 수 없는 작품, 'hidden': 숨긴 회차 */
    state: data,
    reader: ok,
    sentences,
    readerClass: (look.eff === 'world' ? `th-${theme} themed${lite ? ' lite' : ''}` : `calm rd calm-${theme}`) + ' reader',
    readerVars: { ...(look.eff === 'white' || look.eff === 'night' ? LOOK_VARS[look.eff] : {}), '--fs': look.fs + 'px' },
    amb: look.eff === 'world' && look.motion ? { lite } : null,
    selected,
    /** 목업 selectSent(): 고른 문장과 팝업(댓글·피드백·공유) 위치 */
    select: (s: { k: number; top: number; left: number } | null) => setSelected(s && { ...s, pop: true }),
    sheet,
    /** 시트를 열면 목업처럼 문장 팝업을 닫고 선택 표시는 남깁니다. */
    openSheet: (s: ReaderSheet) => { setSelected((x) => x && { ...x, pop: false }); setSheet(s) },
    closeSheet: () => setSheet(null),
    share: () => toast('링크 공유는 데모예요 (실제 복사 없음)'),
    shareSentence: () => toast('문장 공유는 데모예요 (실제 복사 없음)'),
    setEnd,
    toggleCommentLike: (key: string) => feedbackUseCase.toggleCommentLike(key).then(() => dispatch(sessionActions.dataChanged())),
  }
}
