import { useCallback, useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../app/appContainer'
import { planStartBlocker, type PlanInput, type PlanReferences, type StoryPlan } from '../../../domain/entities/storyPlan'
import type { StoryPlanUseCase } from '../../../domain/usecases/StoryPlanUseCase'

type Editor = { value: PlanInput; initial: PlanInput; previous?: StoryPlan }
const empty = (parentId: string | null): PlanInput => ({ kind: parentId ? 'scene' : 'plot', parentId, title: '', content: '', episodeNumber: null, characterIds: [], placeIds: [] })
const historyIndex = (state: unknown) => typeof state === 'object' && state !== null && 'idx' in state && typeof state.idx === 'number' ? state.idx : null

export function useStoryPlanViewModel(workId: string, demo: boolean, api: StoryPlanUseCase = appContainer.resolve(demo ? 'demoStoryPlanUseCase' : 'storyPlanUseCase'), embedded = false) {
  const [plans, setPlans] = useState<StoryPlan[]>([])
  const [references, setReferences] = useState<PlanReferences | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleting, setDeleting] = useState<StoryPlan | null>(null)
  const [deleteNeedsReview, setDeleteNeedsReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [version, setVersion] = useState(0)
  const pending = useRef<AbortController | null>(null)
  const editorRead = useRef<AbortSignal | null>(null)
  const mutating = useRef(false)
  const dirty = !!editor && JSON.stringify(editor.value) !== JSON.stringify(editor.initial)
  const state = useRef({ dirty, busy })
  state.current = { dirty, busy: busy && mutating.current }

  const run = useCallback(async <T,>(action: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void, mutation = false) => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    mutating.current = mutation
    state.current.busy = mutation
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await action(controller.signal)
      if (!controller.signal.aborted) apply(result)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '계획을 처리하지 못했어요. 다시 시도해 주세요.')
    } finally {
      if (pending.current === controller) {
        pending.current = null
        if (!controller.signal.aborted) { setBusy(false); setReady(true) }
      }
    }
  }, [])
  const load = useCallback(() => run(signal => Promise.all([api.list(workId, signal), api.references(workId, signal)]), ([rows, refs]) => {
    setPlans(rows); setReferences(refs); setDeleteNeedsReview(false)
    setSelected(before => rows.some(p => p.id === before && p.kind === 'plot') ? before : rows.find(p => p.kind === 'plot')?.id ?? null)
  }), [api, workId, run])

  useEffect(() => {
    setPlans([]); setReferences(null); setSelected(null); setEditor(null); setDeleting(null); setDeleteNeedsReview(false); setReady(false)
    void load()
    return () => { pending.current?.abort(); pending.current = null }
  }, [load])

  const mayLeave = useCallback(() => {
    if (state.current.busy) return false
    if (state.current.dirty && !window.confirm('저장하지 않은 변경을 버리고 계속할까요?')) return false
    if (pending.current && pending.current.signal === editorRead.current) {
      pending.current.abort()
      pending.current = null
      setBusy(false)
    }
    state.current.dirty = false
    setEditor(null)
    return true
  }, [])

  useEffect(() => {
    if (embedded) return
    const beforeLeave = (event: Event) => { if (!mayLeave()) event.preventDefault() }
    const beforeUnload = (event: BeforeUnloadEvent) => { if (state.current.dirty || state.current.busy) event.preventDefault() }
    const click = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('a[href],.sbar button')) return
      if (!mayLeave()) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    // BrowserRouter uses history indices. Restore the previous entry when an unsaved back/forward move is declined.
    const currentIndex = historyIndex(window.history.state)
    const pop = (event: PopStateEvent) => {
      if (!state.current.dirty && !state.current.busy) return
      const nextIndex = historyIndex(event.state)
      if (currentIndex === null || nextIndex === null || currentIndex === nextIndex) return
      if (!mayLeave()) { event.stopImmediatePropagation(); window.history.go(currentIndex - nextIndex) }
    }
    window.addEventListener('sf-before-leave', beforeLeave)
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    window.addEventListener('popstate', pop, true)
    return () => {
      window.removeEventListener('sf-before-leave', beforeLeave)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
      window.removeEventListener('popstate', pop, true)
    }
  }, [mayLeave, dirty, busy, embedded])

  const edit = (plan: StoryPlan) => {
    if (!mayLeave()) return
    void run(signal => {
      editorRead.current = signal
      return Promise.all([api.read(workId, plan.id, signal), api.references(workId, signal)])
    }, ([fresh, refs]) => {
      setReferences(refs)
      const value: PlanInput = { kind: fresh.kind, parentId: fresh.parentId, title: fresh.title, content: fresh.content, episodeNumber: fresh.episodeNumber, characterIds: fresh.characterIds, placeIds: fresh.placeIds }
      setEditor({ value, initial: value, previous: fresh })
    })
  }
  const create = (parentId: string | null, episode: number | null = null) => {
    if (!references || !mayLeave()) return
    const value = { ...empty(parentId), episodeNumber: parentId ? episode : null }
    setEditor({ value, initial: value }); setError(''); setNotice('')
  }
  const save = () => {
    if (!editor) return
    void run(async signal => {
      const saved = await api.save(workId, editor.value, editor.previous, signal)
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      setPlans(rows => rows.some(p => p.id === saved.id) ? rows.map(p => p.id === saved.id ? saved : p) : [...rows, saved])
      if (saved.kind === 'plot') setSelected(saved.id)
      setNotice('계획을 저장했어요.')
      // A committed save stays acknowledged even when the subsequent list refresh fails.
      state.current.dirty = false; setEditor(null); setVersion(v => v + 1)
      return { saved, rows: await api.list(workId, signal) }
    }, ({ saved, rows }) => {
      setPlans(rows)
      if (saved.kind === 'plot') setSelected(saved.id)
      state.current.dirty = false; setEditor(null); setNotice('계획을 저장했어요. 원고·사전은 변경되지 않아요.')
    }, true)
  }
  const remove = () => {
    if (!deleting || deleteNeedsReview || pending.current) return
    // 응답이 불명확한 경우에도 재전송 전 최신 목록에서 대상을 확인한다.
    setDeleteNeedsReview(true)
    void run(signal => api.remove(workId, deleting, signal), () => {
      setVersion(v => v + 1)
      setPlans(rows => rows.filter(p => p.id !== deleting.id)); setSelected(before => before === deleting.id ? plans.find(p => p.kind === 'plot' && p.id !== deleting.id)?.id ?? null : before); setDeleting(null); setDeleteNeedsReview(false)
      setNotice('계획을 삭제했어요. 연결된 원고·사전은 유지돼요.')
    }, true)
  }
  const reviewDelete = () => {
    if (!deleting || pending.current) return
    setDeleteNeedsReview(true)
    void run(signal => api.reviewDeletion(workId, deleting.id, signal), ({ plans: rows, target }) => {
      setPlans(rows); setDeleting(target); setDeleteNeedsReview(false)
      setNotice(target ? '최신 내용을 불러왔어요. 내용을 확인한 뒤 삭제를 다시 선택해 주세요.' : '최신 목록에서 해당 계획을 찾을 수 없어요.')
    })
  }
  return {
    version, embedded, startBlocker: planStartBlocker({ dirty, busy }) || (error ? '계획 상태를 확인하지 못했어요. 다시 불러온 뒤 시작해 주세요.' : ''),
    confirmLeave: () => !state.current.busy && (!state.current.dirty || window.confirm('저장하지 않은 계획이 있어요. 계속할까요? 회차 이동에서는 입력을 유지하고, 페이지를 떠나면 사라져요.')),
    move: (plan: StoryPlan, position: number) => {
      if (!mayLeave()) return
      void run(async signal => {
        let saved: StoryPlan
        try { saved = await api.move(workId, plan, position, signal) } finally { if (!signal.aborted) setVersion(v => v + 1) }
        setPlans(rows => rows.map(p => p.id === saved.id ? saved : p))
        // A committed move stays acknowledged even when the subsequent list refresh fails.
        setNotice('장면 순서를 저장했어요.')
        return api.list(workId, signal)
      }, rows => { setPlans(rows); setNotice('장면 순서를 저장했어요.') }, true)
    },
    plans, references, selected: plans.find(p => p.id === selected) ?? null, editor, deleting, deleteNeedsReview, busy, ready, error, notice, dirty,
    // 응답을 잃은 저장도 서버에는 남을 수 있으므로 다시 불러오면 시작 양식도 다시 읽게 한다.
    reload: () => { if (mayLeave()) { setVersion(v => v + 1); void load() } },
    select: (id: string) => { if (!mayLeave()) return; void run(signal => api.read(workId, id, signal), fresh => { setPlans(rows => rows.map(p => p.id === id ? fresh : p)); setSelected(id) }) },
    create, edit, save, remove, reviewDelete,
    change: (patch: Partial<PlanInput>) => setEditor(before => before ? { ...before, value: { ...before.value, ...patch } } : null),
    closeEditor: () => { if (mayLeave()) setError('') },
    askDelete: (plan: StoryPlan) => { if (mayLeave()) { setDeleting(plan); setError(''); setNotice('') } },
    closeDelete: () => { if (!pending.current) { setDeleting(null); setError(''); setNotice('') } },
  }
}
