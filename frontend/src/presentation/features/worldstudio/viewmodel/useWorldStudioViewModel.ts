import { cardLibraryRows, type WritingIssue, worldSealIssues, worldWritingIssues } from '../../../../domain/entities/worldStudioWriting'
import { initialWorldStudioFlow, legacyTabTarget, type ManageView, NEW_WORLD_QUERY, parseManageView, type StudioStep, studioMode, worldStudioFlow } from './worldStudioFlow'
import { listingOf, needsPublicConfirm, PUBLIC_CONFIRM, publicationNotice } from './worldPublication'
import { useWorldCoverImage } from './useWorldCoverImage'
import { worldStudioStorage } from './worldStudioStorage'
import {
  applyRelationChanges,
  assertNoNewRelationDuplicates,
  cardDeletionInfo,
  editStudioSetting,
  type RelationInput,
  removeCard,
} from '../../../../domain/entities/studioRelations'
import { areaPatch, type CardType, cardTypeOf, cardTypePatch } from '../../../../domain/entities/studioCards'
import { useContext, useEffect, useReducer, useRef, useState } from 'react'
import { RestoreContext } from '../../../shared/session/restoreContext'
import { WorldStudioLeaveContext } from './worldStudioLeaveGuard'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { appContainer } from '../../../../app/appContainer'
import { appendImported, type ImportedSettings } from '../../../shared/importCards'
import {
  newSetting,
  type SettingItem,
  type StudioSetting,
  type StudioWorld,
  type WorldPublicationInput,
} from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

/** 편집 화면을 게시판에서 들어와 연 기록인지(그 앞 기록이 게시판이라 '← 설정집'이 한 걸음 뒤로 가면 된다). */
const cameFromBoard = (state: unknown) => typeof state === 'object' && state !== null && 'fromList' in state && state.fromList === true

export function useWorldStudioViewModel(
  useCase: WorldStudioUseCase = appContainer.resolve('worldStudioUseCase'),
) {
  const { worldId = '' } = useParams()
  const restoring = useContext(RestoreContext)
  const navigate = useNavigate()
  const location = useLocation()
  const leaveGuard = useContext(WorldStudioLeaveContext)
  const [flow, dispatchFlow] = useReducer(worldStudioFlow, initialWorldStudioFlow)
  const [params, setParams] = useSearchParams()
  const mode = studioMode(params)
  const view = parseManageView(params.get('view'))
  const cardParam = params.get('card') ?? ''
  const legacyTab = params.get('tab')
  // 보기·마법사 표시·편집 중인 카드는 주소의 쿼리라 새로고침해도 유지되고, 바꿀 때는 기본으로 기록을 쌓지 않는다(같은 화면 이동이라 이탈 확인도 하지 않는다).
  // setSearchParams는 같은 틱에 두 번 부르면 뒤 호출이 앞 호출을 덮으므로, 주소를 바꾸는 동작은 한 번의 호출로 묶는다.
  const editParams = (change: (next: URLSearchParams) => void, replace = true, state: unknown = location.state) => setParams((current) => {
    const next = new URLSearchParams(current)
    change(next)
    return next
  }, { replace, state })
  const leaveWizard = () => editParams((query) => query.delete(NEW_WORLD_QUERY))
  /** 설정집 화면의 보기를 바꾼다. 편집 화면이 열려 있으면 함께 닫는다. */
  const setView = (next: ManageView) => {
    if (next === view && !selected) return
    editParams((query) => {
      query.delete('card')
      if (next === 'book') query.delete('view')
      else query.set('view', next)
    })
  }
  const [reviewOpen, setReviewOpen] = useState(false) // AI 후보 검토 시트
  // 옛 주소의 ?tab=은 그 탭을 대신한 보기·시트로 옮긴다(AI 후보 검토는 시트, 확정 버전·세계관 탐색은 설정집).
  useEffect(() => {
    const target = legacyTabTarget(legacyTab)
    if (!target) return
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('tab')
      if (target.view === 'book') next.delete('view')
      else next.set('view', target.view)
      return next
    }, { replace: true })
    if (target.review) setReviewOpen(true)
  }, [legacyTab, setParams])
  const [cardFilter, setCardFilter] = useState<CardType | 'all'>('all')
  const [cardQuery, setCardQuery] = useState('')
  const [relationWorld, setRelationWorld] = useState('')
  const [relationRequest, setRelationRequest] = useState<{ id: string; seq: number } | null>(null)
  const [relationKey, setRelationKey] = useState(0)
  const [episode, setEpisode] = useState<number | null>(null) // 관계 기준 회차(DEC-51). null이면 최신 회차이고, 읽기·저장이 이 회차 시점의 관계를 쓴다.
  const returnCard = useRef('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [worlds, setWorlds] = useState<StudioWorld[]>([])
  const [saved, setSaved] = useState<StudioWorld | null>(null)
  const [editing, setEditing] = useState<StudioWorld | null>(null)
  const [cardUndo, setCardUndo] = useState<
    {
      worldId: string
      id: string
      title: string
      person: boolean
      before: StudioSetting[]
      after: StudioSetting[]
      wasDirty: boolean
    } | null
  >(null)
  const [dirty, setDirty] = useState(false)
  const [relationDirty, setRelationDirty] = useState(false)
  // 편집 중인 카드는 주소의 card이고, 초안에 없는 카드(새로고침으로 사라진 미저장 카드·지운 카드)면 없는 것으로 본다.
  const selected = editing?.settings.some((row) => row.item.id === cardParam) ? cardParam : ''
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(restoring)
  const [reviewBusy,setReviewBusy]=useState(false)
  const [publishing, setPublishing] = useState<WorldPublicationInput | null>(null) // 전송 중인 공개 설정. 컨트롤만 이 값을 앞서 보이고 칩·링크는 서버 값을 따른다
  const [coverRevision, setCoverRevision] = useState(0) // 표지를 올리거나 지울 때마다 올라가 이미지를 다시 읽게 한다
  const [coverAction, setCoverAction] = useState<'upload' | 'remove' | null>(null)
  useEffect(() => {
    leaveGuard?.setDirty(dirty)
    return () => leaveGuard?.setDirty(false)
  }, [dirty, leaveGuard])
  useEffect(() => {
    leaveGuard?.setRelationDirty(relationDirty)
    return () => leaveGuard?.setRelationDirty(false)
  }, [relationDirty, leaveGuard])
  const editingId = editing?.id
  useEffect(() => {
    dispatchFlow({ type: 'world', id: editingId })
    setCardFilter('all')
    setCardQuery('')
    setRelationWorld('')
    setRelationRequest(null)
    returnCard.current = ''
  }, [editingId])
  // 주소만으로 인물 관계도 보기를 열어도(새로고침·공유) 관계 편집기가 마운트되게 한다. 한 번 열린 편집기는 보기를 옮겨도 남아 적용하지 않은 입력을 지킨다.
  useEffect(() => {
    if (mode === 'manage' && view === 'people' && editingId) setRelationWorld(editingId)
  }, [mode, view, editingId])
  /** 작성 모드는 단계를 옮기고, 관리 모드는 그 단계에 해당하는 보기(설정 카드 → 설정집, 관계 연결 → 인물 관계도)로 옮긴다. 열려 있던 편집 화면은 닫는다. */
  const goStep = (step: StudioStep) => {
    dispatchFlow({ type: 'step', step })
    if (step === 'relations' && editing) setRelationWorld(editing.id)
    if (mode === 'manage') setView(step === 'relations' ? 'people' : 'book')
    else if (selected) editParams((query) => query.delete('card'))
  }
  /** 설정 카드의 편집 화면을 연다. 게시판에서 들어올 때는 기록을 쌓아 뒤로가기·'← 설정집'이 게시판으로 돌아오게 하고, 편집 화면 안에서 다른 카드로 옮길 때는 같은 기록을 바꾼다. */
  const editCard = (id: string) => {
    const row = editing?.settings.find((item) => item.item.id === id)
    if (row && cardLibraryRows([row], 'all', '').length && !cardLibraryRows([row], cardFilter, cardQuery).length) {
      setCardFilter('all')
      setCardQuery('')
    }
    dispatchFlow({ type: 'step', step: 'cards' })
    editParams((query) => query.set('card', id), !!selected, selected ? location.state : { fromList: true })
  }
  /** 편집 화면을 닫고 설정집 화면으로 돌아온다. 게시판에서 들어왔으면 한 걸음 뒤로(기록이 쌓이지 않는다), 주소로 바로 들어왔으면 주소만 바꾼다. */
  const closeCard = () => {
    if (selected && cameFromBoard(location.state)) navigate(-1)
    else editParams((query) => query.delete('card'))
  }
  const generation = useRef(0)
  const mutation = useRef<AbortController | null>(null)
  const install = (w: StudioWorld) => {
    setCardUndo(null)
    setSaved(w)
    setEditing(structuredClone(w))
    setSaveState('idle')
    setDirty(false)
    setWorlds((ws) => [...ws.filter((x) => x.id !== w.id), w])
  }
  useEffect(() => {
    if (restoring) return
    const controller = new AbortController()
    const current = ++generation.current
    setCardUndo(null)
    setSaved(null)
    setEditing(null)
    setDirty(false)
    setEpisode(null)
    setError('')
    setMessage('')
    setBusy(true)
    Promise.all([
      useCase.list(controller.signal),
      worldId ? useCase.read(worldId, controller.signal) : Promise.resolve(null),
    ]).then(([ws, w]) => {
      if (generation.current !== current) return
      setWorlds(ws)
      if (w) {
        setSaved(w)
        setEditing(structuredClone(w))
      }
    }).catch((e) => {
      if (generation.current === current && !controller.signal.aborted) {
        setError(e instanceof Error ? e.message : '세계관을 읽지 못했어요.')
      }
    }).finally(() => {
      if (generation.current === current) setBusy(false)
    })
    return () => {
      controller.abort()
      mutation.current?.abort()
      mutation.current = null
      generation.current = current + 1
    }
  }, [useCase, worldId, restoring])
  useEffect(() => {
    if (!dirty && !relationDirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, relationDirty])
  const perform = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (mutation.current || reviewBusy) return
    const controller = new AbortController()
    mutation.current = controller
    const current = generation.current
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action(controller.signal)
    } catch (e) {
      if (current === generation.current) {
        setError(e instanceof Error ? e.message : '요청하지 못했어요. 입력은 유지돼요.')
      }
    } finally {
      if (mutation.current === controller) mutation.current = null
      if (current === generation.current) setBusy(false)
    }
  }
  const apply = (w: StudioWorld, current: number) => {
    if (generation.current === current) install(w)
  }
  const patch = (p: Partial<StudioWorld>) => {
    setCardUndo(null)
    setEditing((w) => w ? { ...w, ...p } : null)
    setDirty(true)
    setMessage('')
  }
  const changeRelations = (change: (settings: StudioSetting[]) => StudioSetting[]) => {
    if (!editing || busy) return
    try {
      const settings = change(editing.settings)
      if (settings !== editing.settings) patch({ settings })
      setError('')
      return settings
    } catch (e) {
      setError(e instanceof Error ? e.message : '관계를 변경하지 못했어요.')
    }
  }
  const writingIssues = editing ? worldWritingIssues(editing) : []
  // 이름·설명 인라인 저장은 초안 전체를 저장하므로, 저장하지 않은 수정이나 저장 전 확인 항목이 있으면 그 변경이 검사 없이 함께 저장된다 → 먼저 저장하게 막는다.
  const infoLocked = dirty || writingIssues.length > 0
  // 저장할 수 있는지: 바뀐 것이 있거나 한 번도 저장한 적 없는 세계관(첫 저장)이고, 저장 전 확인 항목이 없다.
  const canSave = !busy && !reviewBusy && (dirty || saved?.version === 0) && writingIssues.length === 0
  // 관계 기준 회차를 바꿀 수 없는 이유(바꿀 수 있으면 빈 글): 회차를 모르는 데모(메모리), 소설이 없어 1화 하나뿐인 세계관, 다시 읽으면 잃는 저장하지 않은 변경.
  const episodeLock = !useCase.supportsRelationEpisodes ? '데모에서는 지원하지 않아요.'
    : !saved?.linkedWorkId ? '소설을 연결하면 회차별로 기록할 수 있어요.'
    : dirty || relationDirty ? '저장하지 않은 변경이 있어 회차를 바꿀 수 없어요. 먼저 세계관을 저장하세요.' : ''
  const publication: WorldPublicationInput = { visibility: saved?.visibility ?? 'private', genre: saved?.genre ?? null }
  const demo = import.meta.env.MODE === 'mockup'
  const listing = listingOf(saved, demo)
  const cover = useWorldCoverImage(useCase, saved?.id, !!saved?.hasCover && useCase.supportsCover, coverRevision)
  // 초안 저장: 이름·설명 인라인 편집과 '세계관 저장'이 같은 흐름을 쓴다.
  const persist = async (target: StudioWorld, signal: AbortSignal) => {
    const current = generation.current
    setSaveState('saving')
    try {
      if (saved && saved.id === target.id) {
        assertNoNewRelationDuplicates(target.settings, saved.settings)
      }
      apply(await (episode === null ? useCase.save(target, signal) : useCase.save(target, signal, episode)), current)
      if (current === generation.current) {
        setMessage(worldStudioStorage(import.meta.env.MODE).saved)
      }
    } catch (e) {
      if (current === generation.current) setSaveState('failed')
      throw e
    }
  }
  return {
    reviewWorldId:worldId,
    setReviewBusy,
    reload:async(expected?:{resultDraftRevision:number|null;createdCardIds:string[];createdRelationshipIds:string[]})=>{if(dirty||relationDirty)throw new Error('작성 중인 입력을 먼저 저장해 주세요.');const current=generation.current;const w=await useCase.read(worldId);if(current!==generation.current)throw new Error('다른 세계관으로 이동했어요.');if(expected&&(expected.resultDraftRevision===null||w.version<expected.resultDraftRevision||[...expected.createdCardIds,...expected.createdRelationshipIds].some(id=>!w.settings.some(s=>s.item.id===id))))throw new Error('반영된 설정 재조회를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');install(w);setEpisode(null);setRelationKey(v=>v+1);return w},
    storage: worldStudioStorage(import.meta.env.MODE),
    canUndoCardDeletion: !!cardUndo,
    /** 방금 지운 카드(되돌릴 수 있는 동안). 이름·인물 여부로 되돌리기 안내를 만든다. */
    deletedCard: cardUndo ? { id: cardUndo.id, title: cardUndo.title, person: cardUndo.person } : null,
    flow,
    /** 설정집 화면(게시판)의 보기(주소 `?view=`): 설정집·인물 관계도·시간선. 작성 모드는 보기가 없다. */
    view,
    setView,
    /** AI 후보 검토 시트가 열려 있는지(옛 `?tab=analysis` 주소도 이걸 연다). */
    reviewOpen,
    setReviewOpen,
    /** 작성 모드(마법사)를 나가 관리 모드로 간다(주소의 `new` 쿼리를 지운다). 입력은 그대로 남는다. */
    leaveWizard,
    canSave,
    cardFilter,
    setCardFilter,
    cardQuery,
    setCardQuery,
    relationWorld,
    relationKey,
    relationRequest,
    goStep,
    editCard,
    closeCard,
    saveState,
    resume: () => dispatchFlow({ type: 'resume' }),
    openRelations: (id: string) => {
      returnCard.current = id
      goStep('relations')
    },
    editRelation: (id: string) => {
      setRelationRequest((previous) => ({ id, seq: (previous?.seq ?? 0) + 1 }))
      goStep('relations')
    },
    returnToCard: () => {
      if (returnCard.current) editCard(returnCard.current)
      else goStep('cards')
    },
    cardRows: cardLibraryRows(editing?.settings ?? [], cardFilter, cardQuery),
    writingIssues,
    /** 저장 전 확인 사유가 가리키는 곳을 연다: 설정의 문제면 그 설정의 편집 화면, 세계관 자체의 문제(이름)면 기본 정보 단계다. */
    openIssue: (issue: WritingIssue) => (issue.id ? editCard(issue.id) : goStep('info')),
    sealIssues: saved ? worldSealIssues(saved) : [],
    worlds,
    saved,
    editing,
    dirty,
    relationDirty,
    setRelationDirty,
    confirmRelationDiscard: () => leaveGuard
      ? leaveGuard.confirmRelationDiscard()
      : !relationDirty || window.confirm('적용하지 않은 관계 입력을 버릴까요?'),
    /** 편집 화면에서 보고 있는 카드의 id(없으면 설정집 화면). 주소의 `?card=`에서 정한다. */
    selected,
    error,
    message,
    busy:busy||reviewBusy,
    create: (name: string, description: string) =>
      perform(async (signal) => {
        if (
          leaveGuard
            ? !leaveGuard.confirmBeforeAction()
            : (dirty || relationDirty) && !window.confirm('저장하지 않은 변경이 있어요. 새 세계관을 만들까요?')
        ) return
        const current = generation.current
        const w = await useCase.create(name, description, signal)
        if (generation.current === current) {
          leaveGuard?.allowNextNavigation()
          navigate(`/worldstudio/${w.id}?${NEW_WORLD_QUERY}=1`) // 만든 직후에만 마법사로 연다
        }
      }),
    open: (id: string) => {
      if (
        leaveGuard
          ? !leaveGuard.confirmBeforeAction()
          : (dirty || relationDirty) && !window.confirm('저장하지 않은 변경이 있어요. 이동할까요?')
      ) return
      if (id !== worldId) {
        leaveGuard?.allowNextNavigation()
        navigate('/worldstudio/' + id)
        return
      }
      return perform(async (signal) => {
        const current = generation.current
        const world = await useCase.read(id, signal)
        if (generation.current === current && !signal.aborted) {
          setEpisode(null)
          setRelationKey((key) => key + 1)
          setRelationRequest(null)
          setRelationDirty(false)
          apply(world, current)
        }
      })
    },
    /** 관계 기준 회차(DEC-51, 연결된 소설의 회차 순번). null이면 최신 회차다. */
    episode,
    /** 회차를 바꿀 수 없는 이유(데모·소설 미연결·저장하지 않은 변경), 바꿀 수 있으면 빈 글이다. */
    episodeLock,
    /** 그 회차 시점의 관계로 초안을 다시 읽는다(null이면 최신). 읽지 못하면 이전 회차 그대로 오류를 보이고, 잠겨 있거나 같은 회차면 읽지 않는다. */
    selectEpisode: (next: number | null) => {
      if (episodeLock || next === episode || !saved) return
      return perform(async (signal) => {
        const current = generation.current
        const world = await (next === null ? useCase.read(saved.id, signal) : useCase.read(saved.id, signal, next))
        if (generation.current === current && !signal.aborted) {
          setEpisode(next)
          setRelationKey((key) => key + 1) // 관계 편집기를 새로 열어 지난 회차의 선택·입력이 남지 않게 한다
          setRelationRequest(null)
          setRelationDirty(false)
          apply(world, current)
        }
      })
    },
    patch,
    applyRelations: (changes: RelationInput[], removed: string[]) =>
      !!changeRelations((settings) => applyRelationChanges(settings, changes, removed, saved?.settings ?? settings)),
    /** 설정 카드(유형 무관) 하나를 지울 때 함께 사라질 관계와 지우지 못하게 막는 설정을 미리 본다. */
    cardDeletionInfo: (id: string) => cardDeletionInfo(editing?.settings ?? [], id),
    /** 설정 카드를 이어진 관계와 함께 초안에서 지운다(저장해야 서버에 반영). 지운 카드가 편집 화면에 열려 있으면 설정집으로 돌아가고, 되돌릴 수 있다. 지웠을 때만 true다. */
    deleteCard: (id: string) => {
      if (!editing) return false
      const before = editing.settings
      const card = before.find((row) => row.item.id === id)
      const after = changeRelations((settings) => removeCard(settings, id))
      if (!after || !card) return false
      setCardUndo({ worldId: editing.id, id, title: card.item.title, person: cardTypeOf(card.item) === 'character', before, after, wasDirty: dirty })
      if (selected === id) closeCard()
      return true
    },
    undoCardDeletion: () => {
      if (
        !editing || !cardUndo || busy || editing.id !== cardUndo.worldId ||
        editing.settings !== cardUndo.after
      ) return
      const id = cardUndo.id
      patch({ settings: cardUndo.before })
      setDirty(cardUndo.wasDirty)
      return id
    },
    /** 초안에 카드를 더하고 그 id를 돌려준다. 편집 화면은 부르는 쪽이 `editCard`로 연다. */
    addCard: (type: CardType | 'note') => {
      if (!editing || busy) return
      const s = newSetting()
      if (type === 'note') s.item.kind = 'note'
      else Object.assign(s.item, cardTypePatch(s.item, type, []))
      patch({ settings: [...editing.settings, s] })
      return s.item.id
    },
    changeCardType: (id: string, type: CardType) => {
      if (!editing || busy) return
      const row = editing.settings.find((s) => s.item.id === id)
      if (!row) return
      try {
        const change = cardTypePatch(row.item, type, editing.settings)
        if (Object.keys(change).length) {
          patch({ settings: editStudioSetting(editing.settings, id, change) })
        }
        setError('')
      } catch (e) {
        setError(e instanceof Error ? e.message : '유형을 바꾸지 못했어요.')
      }
    },
    changeArea: (id: string, category: SettingItem['category']) => {
      if (!editing || busy) return
      const row = editing.settings.find((s) => s.item.id === id)
      if (!row) return
      try {
        const change = areaPatch(row.item, category)
        patch({
          settings: editing.settings.map((s) =>
            s.item.id === id ? { ...s, item: { ...s.item, ...change } } : s
          ),
        })
        setError('')
      } catch (e) {
        setError(e instanceof Error ? e.message : '영역을 바꾸지 못했어요.')
      }
    },
    update: (id: string, item: Partial<SettingItem>, labels?: Partial<StudioSetting>) => {
      if (editing) patch({ settings: editStudioSetting(editing.settings, id, item, labels) })
    },
    /**
     * 다른 세계관에서 가져온 카드(와 그 사이 관계)를 초안 끝에 더한다(저장해야 서버에 반영). 더했을 때만 true이고,
     * 서버 한도(설정 카드 1,000개)를 넘기는 등 더할 수 없으면 초안을 그대로 두고 이유를 던진다(가져오기 시트가 보인다).
     */
    importSettings: (imported: ImportedSettings) => {
      if (!editing || busy) return false
      patch({ settings: appendImported(editing.settings, imported, saved?.settings) })
      setMessage(`설정 ${imported.cards.length}개를 초안에 가져왔어요. 저장해야 반영돼요.`)
      return true
    },
    /** 이 세계관에 연결된 내 소설 id(없으면 null). 세계관과 소설은 1:1이고, 연결은 초안 저장과 별개로 서버에 바로 적용된다. */
    linkedWorkId: saved?.linkedWorkId ?? null,
    /** 연결된 소설의 작품 관리 화면 주소(`/content`의 그 작품). 헤더 행동 줄의 `소설 작성하기`가 간다(없으면 그 자리는 `소설 연결하기`다). */
    linkedWorkHref: saved?.linkedWorkId ? `/content?work=${encodeURIComponent(saved.linkedWorkId)}` : null,
    /** 소설 연결이 바뀌면 화면 상태에 반영한다(저장 응답을 그대로 돌려주는 메모리 저장소에서도 다음 저장 뒤에 남도록 편집본에도 둔다). */
    setLinkedWork: (linkedWorkId: string | null) => {
      setSaved((w) => w && { ...w, linkedWorkId })
      setEditing((w) => w && { ...w, linkedWorkId })
    },
    save: () => {
      return perform(async (signal) => {
        if (!editing) return
        const current = generation.current
        await persist(editing, signal)
        if (mode === 'write' && current === generation.current) leaveWizard() // 마법사의 첫 저장이 성공하면 관리 모드로
      })
    },
    /** 정보 편집 패널을 잠글지: 저장하지 않은 수정이나 저장 전 확인 항목이 있으면 true다(헤더 '편집' 비활성·패널 저장 잠금). */
    infoLocked,
    /** 정보 편집 패널의 이름·설명. 기존 초안 저장으로 보내고 저장됐을 때만 true다(실패는 오류 문구로 알리고 false). 잠겨 있으면 보내지 않는다. */
    saveInfo: async (name: string, description: string) => {
      if (!editing || infoLocked) return false
      let done = false
      await perform(async (signal) => {
        await persist({ ...editing, name, description }, signal)
        done = true
      })
      return done
    },
    /** 작성 모드는 한 번도 저장하지 않은 세계관, 관리 모드는 저장한 적 있는 세계관이다. */
    mode,
    /** 서버에 저장된 공개 범위·장르(값이 없으면 비공개·미지정) */
    publication,
    publishing,
    /** 올린 표지 이미지(소유자 인증 읽기 → 객체 주소). 표지가 없거나 읽는 중·실패면 `url`이 비어 자동 생성 표지를 쓴다. */
    cover,
    /** 표지 저장소가 있는지. 서버 저장소가 없는 데모(메모리)는 표지 올리기를 지원하지 않는다. */
    supportsCover: useCase.supportsCover,
    /** 표지를 올리거나 지우는 중인 동작(없으면 null). */
    coverAction,
    /** 표지를 올리거나(교체 포함) 지운다(`null`). 초안 저장과 별개로 바로 적용되고 됐을 때만 true다. 실패하면 이전 표지 그대로 오류 문구를 보인다. */
    setCover: async (file: File | null) => {
      if (!saved || busy || reviewBusy || mutation.current) return false
      let done = false
      await perform(async (signal) => {
        const current = generation.current
        setCoverAction(file ? 'upload' : 'remove')
        try {
          if (file) await useCase.setCover(saved.id, file, signal)
          else await useCase.removeCover(saved.id, signal)
          if (current === generation.current) {
            setSaved((w) => (w && w.id === saved.id ? { ...w, hasCover: !!file } : w))
            setCoverRevision((revision) => revision + 1)
            setMessage(file ? '표지를 올렸어요.' : '표지를 지웠어요. 자동으로 만든 표지를 써요.')
            done = true
          }
        } finally {
          setCoverAction(null)
        }
      })
      return done
    },
    /** 공개 목록에 나오는지: 공개이고 확정 버전이 있으면 'listed', 공개인데 확정 버전이 없으면 'unlisted'(안내가 필요), 그 밖은 null이다. */
    listing,
    /** 공개 세계관 화면 주소. 공개 목록에 나오는(공개 + 확정 버전) 세계관만 있다. 비공개·확정 버전 없음·데모(메모리)는 링크를 누르면 404이거나 목록에 없다. */
    publicHref: listing === 'listed' && saved ? '/worlds/' + saved.id : null,
    /** 공개 범위·장르를 바로 적용한다(초안 저장과 별개). 같은 값이면 보내지 않고, 비공개에서 공개로 바꿀 때만 한 번 확인한다. 적용됐을 때만 true이고, 실패하면 이전 값 그대로 오류 문구를 보인다. */
    setPublication: async (change: Partial<WorldPublicationInput>) => {
      if (!saved || busy || reviewBusy || mutation.current) return false
      const next = { ...publication, ...change }
      if (next.visibility === publication.visibility && next.genre === publication.genre) return false
      if (needsPublicConfirm(publication.visibility, next.visibility) && !window.confirm(PUBLIC_CONFIRM)) return false
      let done = false
      await perform(async (signal) => {
        const current = generation.current
        setPublishing(next)
        try {
          const result = await useCase.setPublication(saved.id, next, signal)
          if (current === generation.current) {
            setSaved((w) => (w && w.id === result.worldId ? { ...w, visibility: result.visibility, genre: result.genre } : w))
            setMessage(publicationNotice(result, demo))
            done = true
          }
        } finally {
          setPublishing(null)
        }
      })
      return done
    },
  }
}
