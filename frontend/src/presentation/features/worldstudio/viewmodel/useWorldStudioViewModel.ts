import { cardLibraryRows, worldWritingIssues } from '../../../../domain/entities/worldStudioWriting'
import { initialWorldStudioFlow, type StudioStep, worldStudioFlow } from './worldStudioFlow'
import {
  applyRelationChanges,
  editStudioSetting,
  personDeletionInfo,
  type RelationInput,
  removePerson,
} from '../../../../domain/entities/studioRelations'
import { areaPatch, type CardType, cardTypePatch } from '../../../../domain/entities/studioCards'
import { useContext, useEffect, useReducer, useRef, useState } from 'react'
import { RestoreContext } from '../../../shared/session/restoreContext'
import { WorldStudioLeaveContext } from './worldStudioLeaveGuard'
import { useNavigate, useParams } from 'react-router'
import { appContainer } from '../../../../app/appContainer'
import {
  newSetting,
  type SettingItem,
  type StudioSetting,
  type StudioWorld,
} from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

export function useWorldStudioViewModel(
  useCase: WorldStudioUseCase = appContainer.resolve('worldStudioUseCase'),
) {
  const { worldId = '' } = useParams()
  const restoring = useContext(RestoreContext)
  const navigate = useNavigate()
  const leaveGuard = useContext(WorldStudioLeaveContext)
  const [flow, dispatchFlow] = useReducer(worldStudioFlow, initialWorldStudioFlow)
  const [tool, setTool] = useState<'write' | 'explore' | 'analysis'>('write')
  const [explore, setExplore] = useState('map')
  const [cardFilter, setCardFilter] = useState<CardType | 'all'>('all')
  const [cardQuery, setCardQuery] = useState('')
  const [newCardType, setNewCardType] = useState<CardType>('character')
  const [cardDetail, setCardDetail] = useState(false)
  const [relationWorld, setRelationWorld] = useState('')
  const returnCard = useRef('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [worlds, setWorlds] = useState<StudioWorld[]>([])
  const [saved, setSaved] = useState<StudioWorld | null>(null)
  const [editing, setEditing] = useState<StudioWorld | null>(null)
  const [personUndo, setPersonUndo] = useState<
    {
      worldId: string
      id: string
      before: StudioSetting[]
      after: StudioSetting[]
      wasDirty: boolean
    } | null
  >(null)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(restoring)
  useEffect(() => {
    leaveGuard?.setDirty(dirty)
    return () => leaveGuard?.setDirty(false)
  }, [dirty, leaveGuard])
  const editingId = editing?.id
  useEffect(() => {
    if (editingId) dispatchFlow({ type: 'open' })
    setTool('write')
    setCardFilter('all')
    setCardQuery('')
    setCardDetail(false)
    setRelationWorld('')
    returnCard.current = ''
  }, [editingId])
  const goStep = (step: StudioStep) => {
    dispatchFlow({ type: 'step', step })
    setTool('write')
    if (step === 'relations' && editing) setRelationWorld(editing.id)
  }
  const editCard = (id: string) => {
    setSelected(id)
    setCardDetail(true)
    goStep('cards')
  }
  const generation = useRef(0)
  const mutation = useRef<AbortController | null>(null)
  const install = (w: StudioWorld) => {
    setPersonUndo(null)
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
    setPersonUndo(null)
    setSaved(null)
    setEditing(null)
    setDirty(false)
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
        setError(e instanceof Error ? e.message : '세계관을 읽지 못했습니다.')
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
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const perform = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (mutation.current) return
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
        setError(e instanceof Error ? e.message : '요청하지 못했습니다. 입력은 유지됩니다.')
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
    setPersonUndo(null)
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
      setError(e instanceof Error ? e.message : '관계를 변경하지 못했습니다.')
    }
  }
  return {
    canUndoPersonDeletion: !!personUndo,
    flow,
    tool,
    setTool,
    explore,
    setExplore,
    cardFilter,
    setCardFilter,
    cardQuery,
    setCardQuery,
    newCardType,
    setNewCardType,
    cardDetail,
    setCardDetail,
    relationWorld,
    goStep,
    editCard,
    saveState,
    showList: () => dispatchFlow({ type: 'list' }),
    resume: () => dispatchFlow({ type: 'resume' }),
    openRelations: (id: string) => {
      returnCard.current = id
      setSelected(id)
      goStep('relations')
    },
    returnToCard: () => {
      if (returnCard.current) setSelected(returnCard.current)
      setCardDetail(true)
      goStep('cards')
    },
    cardRows: cardLibraryRows(editing?.settings ?? [], cardFilter, cardQuery),
    writingIssues: editing ? worldWritingIssues(editing) : [],
    worlds,
    saved,
    editing,
    dirty,
    selected,
    setSelected,
    error,
    message,
    busy,
    create: (name: string, description: string) =>
      perform(async (signal) => {
        if (
          leaveGuard
            ? !leaveGuard.confirmBeforeAction()
            : dirty && !window.confirm('저장하지 않은 변경이 있습니다. 새 세계관을 만들까요?')
        ) return
        const current = generation.current
        const w = await useCase.create(name, description, signal)
        if (generation.current === current) {
          leaveGuard?.allowNextNavigation()
          navigate('/worldstudio/' + w.id)
        }
      }),
    open: (id: string) => {
      if (
        leaveGuard
          ? !leaveGuard.confirmBeforeAction()
          : dirty && !window.confirm('저장하지 않은 변경이 있습니다. 이동할까요?')
      ) return
      if (id !== worldId) {
        leaveGuard?.allowNextNavigation()
        navigate('/worldstudio/' + id)
        return
      }
      return perform(async (signal) => {
        const current = generation.current
        apply(await useCase.read(id, signal), current)
      })
    },
    patch,
    applyRelations: (changes: RelationInput[], removed: string[]) =>
      !!changeRelations((settings) => applyRelationChanges(settings, changes, removed)),
    personDeletionInfo: (id: string) => personDeletionInfo(editing?.settings ?? [], id),
    deletePerson: (id: string) => {
      if (!editing) return false
      const before = editing.settings
      const after = changeRelations((settings) => removePerson(settings, id))
      if (!after) return false
      setPersonUndo({ worldId: editing.id, id, before, after, wasDirty: dirty })
      return true
    },
    undoPersonDeletion: () => {
      if (
        !editing || !personUndo || busy || editing.id !== personUndo.worldId ||
        editing.settings !== personUndo.after
      ) return
      const id = personUndo.id
      patch({ settings: personUndo.before })
      setDirty(personUndo.wasDirty)
      setSelected(id)
      return id
    },
    addCard: (type: CardType | 'note') => {
      if (!editing || busy) return
      const s = newSetting()
      if (type === 'note') s.item.kind = 'note'
      else Object.assign(s.item, cardTypePatch(s.item, type, []))
      patch({ settings: [...editing.settings, s] })
      setSelected(s.item.id)
      return s.item.id
    },
    changeCardType: (id: string, type: CardType) => {
      if (!editing || busy) return
      const row = editing.settings.find((s) => s.item.id === id)
      if (!row) return
      setSelected(id)
      try {
        const change = cardTypePatch(row.item, type, editing.settings)
        if (Object.keys(change).length) {
          patch({ settings: editStudioSetting(editing.settings, id, change) })
        }
        setError('')
      } catch (e) {
        setError(e instanceof Error ? e.message : '유형을 바꾸지 못했습니다.')
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
        setError(e instanceof Error ? e.message : '영역을 바꾸지 못했습니다.')
      }
    },
    update: (id: string, item: Partial<SettingItem>, labels?: Partial<StudioSetting>) => {
      if (editing) patch({ settings: editStudioSetting(editing.settings, id, item, labels) })
    },
    save: () => {
      setPersonUndo(null)
      return perform(async (signal) => {
        if (!editing) return
        const current = generation.current
        setSaveState('saving')
        try {
          apply(await useCase.save(editing, signal), current)
          if (current === generation.current) {
            setMessage(
              '서버에 현재 세계관을 저장했어요. 관계는 현재 상태만 보관하며 과거 관계 복원은 지원하지 않습니다.',
            )
          }
        } catch (e) {
          if (current === generation.current) setSaveState('failed')
          throw e
        }
      })
    },
  }
}
