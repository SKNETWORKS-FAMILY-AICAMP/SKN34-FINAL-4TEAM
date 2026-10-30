import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import { autoOf, simTurns, type PublishSettings, type StudioUseCase } from '../../../../domain/usecases/StudioUseCase'
import { wikiOf } from '../../../../domain/entities/wiki'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { confirmAi, useAiDemo } from '../../../shared/useAiDemo'
import { useAsyncData } from '../../../shared/useAsyncData'

/** 목업 studio()·bindStudio·syncDraft·markSaving: U13 집필실 원고 화면 */
export function useStudioViewModel(id: string, ep: number | undefined, screen: string, studioUseCase: StudioUseCase = appContainer.resolve('studioUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const aiDemo = useAiDemo()
  const { data } = useAsyncData(() => studioUseCase.open(id, ep, role), [studioUseCase, id, ep, role])
  const [typed, setTyped] = useState<{ key: string; paras: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const sync = useRef<Promise<unknown>>(Promise.resolve())
  const savedTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(savedTimer.current), [])

  const s = data && !('notMine' in data) ? data : null
  const d = s?.draft
  // screen: 원고 보기면 탭(ai·tl·note), 아니면 보기 이름의 화면 ID
  useScreenId(data ? (!s ? 'U13' : screen !== 'ai' ? screen : d?.check?.issues.length ? 'U17' : d?.proposal === 'shown' ? 'U16' : 'U14') : null)
  const key = s?.key ?? ''
  const shown = (typed?.key === key ? typed.paras : null) ?? d?.paras ?? []
  const text = shown.join('\n\n')

  const refresh = (redraw = false) => {
    if (redraw) setTyped(null)
    dispatch(sessionActions.dataChanged())
  }
  const run = async (fn: () => Promise<unknown>, redraw = false) => {
    await sync.current
    await fn()
    refresh(redraw)
  }
  const edit = (patch: Parameters<StudioUseCase['edit']>[1]) => {
    if (patch.paras) setTyped({ key, paras: patch.paras })
    setSaving(true)
    window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaving(false), 600)
    sync.current = sync.current.then(() => studioUseCase.edit(key, patch))
  }

  return {
    data, studio: s, draft: d, // 입력은 다시 그리지 않고, 저장된 원고·검사 결과가 바뀌어 다시 불러왔을 때만 본문을 새로 그립니다.
    bodyKey: key + JSON.stringify([d?.paras, d?.check?.issues]), saving,
    readOnly: !!d?.locked,
    wordCount: `공백 포함 ${Array.from(text).length.toLocaleString('ko-KR')}자 · 공백 제외 ${Array.from(text.replace(/\s/g, '')).length.toLocaleString('ko-KR')}자`,
    edit,
    propose: async (prompt: string) => {
      if (d?.locked) return toast('원작 스냅샷은 수정할 수 없어요')
      if (!await aiDemo('장면 이어쓰기', 5)) return
      await run(() => studioUseCase.propose(key, prompt))
      toast('고정 예시 응답을 표시했어요 · 원고에 넣기 전에는 반영되지 않아요')
    },
    accept: async () => { await run(() => studioUseCase.acceptProposal(id, key), true); toast('소설에 넣었어요 · 설정 검사를 해 보세요') },
    drop: async () => { await run(() => studioUseCase.dropProposal(key)); toast('제안을 버렸어요') },
    check: async () => {
      if (!await aiDemo('설정 검사', 5)) return false
      let n = 0
      await run(async () => { n = await studioUseCase.check(id, key) }, true)
      toast(n ? `${n}곳이 설정과 어긋나요` : '설정과 어긋난 곳이 없어요')
      return true
    },
    fix: async (i: number) => { await run(() => studioUseCase.fix(id, key, i), true); toast('문장을 고쳤어요 · 다시 검사했어요') },
    ignore: async (i: number) => { await run(() => studioUseCase.ignore(key, i)); toast('의도한 표현으로 남겼어요') },
    toggleEpisode: async (index: number) => {
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.toggleEpisode(id, index) })
      if (msg) toast(msg)
    },
    publishing,
    openPublish: async () => {
      if (d?.locked) return toast('원작 스냅샷은 수정 공개할 수 없어요')
      if (s?.work.hidden) return toast('권리 제한 중인 작품은 발행할 수 없어요')
      await sync.current
      refresh()
      setPublishing(true)
    },
    closePublish: () => setPublishing(false),
    publish: async (title: string) => {
      await sync.current
      const r = await studioUseCase.publish(id, key, title)
      if ('error' in r) return toast(r.error)
      setPublishing(false)
      refresh(true)
      toast(r.ok)
      navigate(r.go)
    },
    docs: s ? wikiOf(s.work) : [],
    goWiki: (q: string) => navigate(`/studio/${id}?view=wiki${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
    auto: s ? autoOf(s.work) : null,
    saveNotes: (patch: Parameters<StudioUseCase['saveNotes']>[1]) => run(() => studioUseCase.saveNotes(id, patch)),
    setCastStatus: async (i: number, st: string) => {
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.setCastStatus(id, i, st) })
      if (msg) toast(msg)
    },
    /** 목업 data-work-setting: 결과가 없으면(취소) 화면이 체크를 되돌리도록 다시 불러옵니다. */
    setSetting: async (k: 'autoWorld' | 'typoAuto', on: boolean) => {
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.setSetting(id, k, on, (credits) => confirmAi('세계관 자동 업데이트 설정 · 회당 예시 5', 0, credits)) })
      if (msg) toast(msg)
    },
    extractWorld: async (n: number) => {
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.extractWorld(id, n, (credits) => confirmAi('세계관 설정 추출', 5, credits)) })
      if (msg) toast(msg)
    },
    acceptWorld: async () => { let msg = ''; await run(async () => { msg = await studioUseCase.acceptWorld(id) }); toast(msg) },
    discardWorld: async () => { await run(() => studioUseCase.discardWorld(id)); toast('후보를 제외했어요') },
    setRelease: async (kind: 'rule' | 'event' | 'cast', i: number, value: string) => {
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.setRelease(id, kind, i, value) })
      if (msg) toast(msg)
      return msg
    },
    addEvent: async () => { await run(() => studioUseCase.addEvent(id, key)); toast('이 소설에만 사건을 추가했어요') },
    preview: async () => { await sync.current; toast(shown.length ? `${shown.length}문단 · 공개 전 미리보기는 공개 후 회차 뷰어에서 볼 수 있어요` : '아직 소설이 비어 있어요') },
    toggleAuto: async () => {
      if (!s?.work.auto?.on && !window.confirm('작품 소유자가 AI 자율 연재 비용을 부담합니다. 회당·월간 상한과 실제 비용은 미정이며, 이 데모는 예약 실행이나 AI 호출·차감이 없습니다. 켤까요?')) return
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.toggleAuto(id) })
      if (msg) toast(msg)
    },
    pauseAuto: () => run(() => studioUseCase.pauseAuto(id)),
    setAuto: (k: 'react' | 'requireReview', v: boolean) => run(() => studioUseCase.setAuto(id, k, v)),
    autoGen: async () => {
      if (d?.editingEpisode) return toast('자율 연재는 새 회차 화면에서 실행해 주세요')
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.autoGen(id, (credits) => confirmAi('AI 자율 연재', 5, credits)) }, true)
      if (msg) toast(msg)
    },
    simTurns: (picked: string[]) => (s ? simTurns(s.work, picked) : []),
    runSim: () => aiDemo('인물 시뮬레이션', 30),
    takeSim: async (situation: string, picked: string[], turns: number) => {
      await run(() => studioUseCase.takeSim(id, key, situation, picked, turns))
      toast('시뮬레이션 결과를 집필실로 가져왔어요')
    },
    savePublishSettings: async (st: PublishSettings) => {
      const r = await studioUseCase.savePublishSettings(id, st)
      if ('error' in r) { toast(r.error); return false }
      refresh()
      toast(r.ok)
      return true
    },
    download: async (all: boolean) => {
      await sync.current
      const { name, content } = await studioUseCase.exportText(id, key, all)
      const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.append(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  }
}
