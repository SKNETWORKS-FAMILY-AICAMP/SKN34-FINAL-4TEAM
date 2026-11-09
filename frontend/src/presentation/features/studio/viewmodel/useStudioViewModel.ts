import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { autoOf, simTurns, type PublishSettings, type StudioUseCase } from '../../../../domain/usecases/StudioUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { confirmAi, useAiDemo } from '../../../shared/useAiDemo'
import { useAsyncData } from '../../../shared/useAsyncData'

type DraftPatch = Parameters<StudioUseCase['edit']>[1]
type InvalidatedCheck = { key: string; at: number | null }

/** 목업 studio()·bindStudio·syncDraft·markSaving: U13 집필실 원고 화면 */
export function useStudioViewModel(id: string, ep: number | undefined, screen: string, studioUseCase: StudioUseCase = appContainer.resolve('studioUseCase'), libraryUseCase: LibraryUseCase = appContainer.resolve('libraryUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const aiDemo = useAiDemo()
  const { data } = useAsyncData(async () => {
    // 탭을 전환하거나 조회 중 편집이 들어오면 최신 저장 초안을 읽습니다.
    let pending: Promise<unknown>
    let opened: Awaited<ReturnType<StudioUseCase['open']>>
    do {
      pending = sync.current
      await pending
      opened = await studioUseCase.open(id, ep, role)
    } while (pending !== sync.current)
    return opened
  }, [studioUseCase, id, ep, role], [screen])
  const [typed, setTyped] = useState<{ key: string; paras: string[] } | null>(null)
  const [invalidatedCheck, setInvalidatedCheck] = useState<InvalidatedCheck | null>(null)
  const [prompt, setPrompt] = useState<{ key: string; v: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [failedNotesFor, setFailedNotesFor] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  const [autoGenerating, setAutoGenerating] = useState(false)
  const actionBusy = useRef(false)
  const sync = useRef<Promise<unknown>>(Promise.resolve())
  const failedEdits = useRef(new Map<string, { patch: DraftPatch; invalidation: InvalidatedCheck | null }>())
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
  const flash = () => {
    setSaving(true)
    window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaving(false), 600)
  }
  const enqueue = <T,>(fn: () => Promise<T>) => {
    const pending = sync.current.then(fn)
    // 실패는 해당 호출에 돌려주고, 다음 작업도 실행할 수 있게 합니다.
    sync.current = pending.catch(() => undefined)
    return pending
  }
  const queue = <T,>(fn: () => Promise<T>, saving = true) => {
    if (saving) flash()
    return enqueue(fn).then((result) => {
      refresh()
      return result
    })
  }
  const edit = (patch: DraftPatch, showSaving = true) => {
    if (!d || d.locked) return
    // 저장 전에는 어느 검사 결과가 무효가 될지 알 수 없습니다.
    const invalidation = patch.paras && JSON.stringify(patch.paras) !== JSON.stringify(shown)
      ? { key, at: null }
      : null
    if (invalidation) setInvalidatedCheck(invalidation)
    if (patch.paras) setTyped({ key, paras: patch.paras })
    if (showSaving) flash()
    void enqueue(async () => {
      const failed = failedEdits.current.get(key)
      const nextPatch = failed ? { ...failed.patch, ...patch } : patch
      const nextInvalidation = invalidation ?? failed?.invalidation ?? null
      try {
        const saved = await studioUseCase.edit(key, nextPatch)
        if (!saved) throw new Error('초안을 찾을 수 없어요.')
        failedEdits.current.delete(key)
        if (!nextInvalidation) return
        const check = saved.check
        setInvalidatedCheck((current) => {
          if (current !== nextInvalidation) return current
          return check?.stale ? { key, at: check.at } : null
        })
      } catch {
        failedEdits.current.set(key, { patch: nextPatch, invalidation: nextInvalidation })
        toast('초안을 저장하지 못했어요. 편집을 계속하면 다시 저장을 시도해요.')
      }
    })
  }

  return {
    data, studio: s, draft: d, // 입력은 다시 그리지 않고, 저장된 원고·검사 결과가 바뀌어 다시 불러왔을 때만 본문을 새로 그립니다.
    bodyKey: key + JSON.stringify([d?.paras, d?.check?.issues]), saving, paragraphs: shown,
    notesSaveFailed: failedNotesFor === id,
    readOnly: !!d?.locked,
    wordCount: `공백 포함 ${Array.from(text).length.toLocaleString('ko-KR')}자 · 공백 제외 ${Array.from(text.replace(/\s/g, '')).length.toLocaleString('ko-KR')}자`,
    edit, markSaving: flash,
    checkStale: !!d?.check && (d.check.stale
      || (invalidatedCheck?.key === key && (invalidatedCheck.at === null || d.check.at <= invalidatedCheck.at))),
    prompt: (prompt?.key === key ? prompt.v : null) ?? d?.aiPrompt ?? '',
    setPrompt: (v: string) => { setPrompt({ key, v }); edit({ aiPrompt: v }, false) },
    propose: async (prompt: string) => {
      if (d?.locked) return toast('원작 스냅샷은 수정할 수 없어요')
      if (!await aiDemo('장면 이어쓰기', 5)) return
      await run(() => studioUseCase.propose(key, prompt))
      toast('고정 예시 응답을 표시했어요 · 원고에 넣기 전에는 반영되지 않아요')
    },
    accept: async () => { await run(() => studioUseCase.acceptProposal(id, key), true); toast('소설에 넣었어요 · 설정 검사를 해 보세요') },
    drop: async () => { await run(() => studioUseCase.dropProposal(key)); toast('제안을 버렸어요') },
    check: async () => {
      if (!d || d.locked) return false
      try {
        return await queue(async () => {
          if (failedEdits.current.has(key)) {
            toast('저장되지 않은 편집이 있어요. 초안을 저장한 뒤 검사해 주세요.')
            return false
          }
          if (!await aiDemo('설정 검사', 5)) return false
          const count = await studioUseCase.check(id, key)
          if (count === null) throw new Error('검사할 초안을 찾을 수 없어요.')
          toast(count ? `${count}곳이 설정과 어긋나요` : '설정과 어긋난 곳이 없어요')
          return true
        }, false)
      } catch {
        toast('설정 검사를 완료하지 못했어요. 다시 시도해 주세요.')
        return false
      }
    },
    fix: async (i: number) => { await run(() => studioUseCase.fix(id, key, i), true); toast('문장을 고쳤어요 · 다시 검사했어요') },
    ignore: async (i: number) => { await run(() => studioUseCase.ignore(key, i)); toast('의도한 표현으로 남겼어요') },
    toggleEpisode: async (index: number) => {
      let msg: string | null = null
      await run(async () => { msg = await studioUseCase.toggleEpisode(id, index) })
      if (msg) toast(msg)
    },
    publishing, publishBusy, autoGenerating,
    openPublish: async () => {
      if (actionBusy.current) return
      if (d?.locked) return toast('원작 스냅샷은 수정 공개할 수 없어요')
      if (s?.work.hidden) return toast('권리 제한 중인 작품은 발행할 수 없어요')
      await sync.current
      refresh()
      setPublishing(true)
    },
    closePublish: () => { if (!actionBusy.current) setPublishing(false) },
    publish: async (title: string) => {
      if (actionBusy.current) return
      actionBusy.current = true
      setPublishBusy(true)
      try {
        await sync.current
        if (failedEdits.current.has(key)) return toast('저장되지 않은 편집이 있어요. 초안을 저장한 뒤 공개해 주세요.')
        const r = await studioUseCase.publish(id, key, title)
        if ('error' in r) return toast(r.error)
        setPublishing(false)
        refresh(true)
        toast(r.ok)
        navigate(r.go)
      } catch {
        toast('공개 요청을 완료하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요.')
      } finally {
        actionBusy.current = false
        setPublishBusy(false)
      }
    },
    docs: s?.work.wiki?.docs ?? [],
    cats: s?.work.wiki?.cats ?? [],
    addDoc: async (cat: string, t: string) => {
      let docId: string | null = null
      await queue(async () => { docId = await studioUseCase.addDoc(id, cat, t) }, false)
      if (!docId) return
      toast(`‘${t}’ 문서를 만들었어요`)
      navigate(`/studio/${id}?view=wiki&doc=${encodeURIComponent(docId)}`)
    },
    addCategory: async (n: string) => { await run(() => studioUseCase.addCategory(id, n)); toast('분류를 추가했어요') },
    deleteDoc: async (docId: string) => {
      let cat: string | null = null
      await queue(async () => { cat = await studioUseCase.deleteDoc(id, docId) }, false)
      if (!cat) return
      toast('문서를 지웠어요 (소설은 그대로예요)')
      navigate(`/studio/${id}?view=wiki&cat=${cat}`)
    },
    /** 목업 data-wf·data-wk·data-wv·walias·wtag·wprop: 고치면 '저장 중…'을 잠깐 보여 줍니다. */
    setDocText: (docId: string, f: 't' | 'body', v: string) => queue(() => studioUseCase.setDocText(id, docId, f, v)),
    setDocProp: (docId: string, k: string, v: string, ep?: number) => queue(() => studioUseCase.setDocProp(id, docId, k, v, ep)),
    addDocProp: (docId: string, k: string, v: string) => run(() => studioUseCase.addDocProp(id, docId, k, v)),
    renameDocProp: (docId: string, k: string, nk: string) => queue(() => studioUseCase.renameDocProp(id, docId, k, nk)),
    setEvent: async (docId: string, patch: Parameters<StudioUseCase['setEvent']>[2]) => { await run(() => studioUseCase.setEvent(id, docId, patch)); toast('사건을 수정했어요') },
    toggleWho: (docId: string, n: string) => run(() => studioUseCase.toggleWho(id, docId, n)),
    addLink: async (docId: string, to: string, k: string) => { await run(() => studioUseCase.addLink(id, docId, to, k)); toast('사건을 연결했어요') },
    removeLink: (docId: string, i: number) => run(() => studioUseCase.removeLink(id, docId, i)),
    addBoardEvent: async (t: string, ep: number | undefined, line: string, who: string[]) => {
      await run(() => studioUseCase.addBoardEvent(id, t, ep, line, who))
      toast(ep ? '보드에 사건을 추가했어요' : '시점 미정 사건으로 추가했어요 · 설정 점검에 표시돼요')
    },
    shared: s?.shared ?? null,
    addKnowledge: async (docId: string, k: { text: string; knownAt: number; publicAt?: number }) => { await run(() => studioUseCase.addKnowledge(id, docId, k)); toast('인물 지식을 저장했어요 (데모)') },
    removeKnowledge: (docId: string, i: number) => { if (window.confirm('이 인물 지식을 삭제할까요?')) return run(() => studioUseCase.removeKnowledge(id, docId, i)) },
    setDocImg: async (docId: string, img: string) => { await run(() => studioUseCase.setDocImg(id, docId, img)); toast('대표 이미지를 넣었어요') },
    forkLinkedWorld: async () => {
      const sh = s?.shared
      if (!sh?.allowFork) return toast('세계관 포크가 허용되지 않았어요')
      if (!window.confirm('전체 세계관을 복사하면 이후 원본 변경이 반영되지 않아요. 계속할까요?')) return
      const copy = await libraryUseCase.copyWorld(sh.id)
      if (!copy) return toast('세계관 포크가 허용되지 않았어요')
      await run(() => studioUseCase.replaceWorld(id, sh.id, copy.id))
      toast('연결을 내 세계관 포크로 교체했어요 (데모)')
    },
    addDocChip: (docId: string, f: 'alias' | 'tags', v: string) => run(() => studioUseCase.addDocChip(id, docId, f, v)),
    removeAlias: (docId: string, i: number) => run(() => studioUseCase.removeAlias(id, docId, i)),
    goWiki: (q: string) => navigate(`/studio/${id}?view=wiki${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
    auto: s ? autoOf(s.work) : null,
    saveNotes: async (patch: Parameters<StudioUseCase['saveNotes']>[1]) => {
      try {
        const result = await queue(() => studioUseCase.saveNotes(id, patch), false)
        if (result === null) throw new Error('작품을 저장할 수 없어요.')
        setFailedNotesFor((current) => current === id ? null : current)
        return true
      } catch {
        setFailedNotesFor(id)
        toast('작품 정보를 저장하지 못했어요. 다시 시도해 주세요.')
        return false
      }
    },
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
    discardWorld: async () => { let msg: string | null = null; await run(async () => { msg = await studioUseCase.discardWorld(id) }); if (msg) toast(msg) },
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
      if (actionBusy.current) return
      if (d?.editingEpisode) return toast('자율 연재는 새 회차 화면에서 실행해 주세요')
      actionBusy.current = true
      setAutoGenerating(true)
      try {
        let msg: string | null = null
        await run(async () => { msg = await studioUseCase.autoGen(id, (credits) => confirmAi('AI 자율 연재', 5, credits)) }, true)
        if (msg) toast(msg)
      } catch {
        toast('생성 요청을 완료하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요.')
      } finally {
        actionBusy.current = false
        setAutoGenerating(false)
      }
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
