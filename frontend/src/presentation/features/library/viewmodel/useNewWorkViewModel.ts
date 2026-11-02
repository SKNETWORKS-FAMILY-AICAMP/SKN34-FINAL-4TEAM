import { useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppDispatch, useAppSelector } from '../../../../app/store'
import type { LibraryUseCase, NewWorkInput, WorldForm, WorldPermission } from '../../../../domain/usecases/LibraryUseCase'
import { toast } from '../../../shared/events'
import { useScreenId } from '../../../shared/screenIds'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { useAsyncData } from '../../../shared/useAsyncData'
import { newWorkActions } from '../state/newWorkSlice'

/**
 * 목업 newWork()·NEW·worldManager: U28 새 소설 만들기.
 * 작성 중인 값은 목업 NEW처럼 Redux에 남고, 정책 확인은 화면에 들어올 때마다 다시 받습니다.
 */
export function useNewWorkViewModel(libraryUseCase: LibraryUseCase = appContainer.resolve('libraryUseCase')) {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const form = useAppSelector((s) => s.newWork)
  const { data: worlds } = useAsyncData(() => libraryUseCase.getWorlds(), [libraryUseCase])
  useScreenId('U28')

  const set = (patch: Partial<NewWorkInput>) => dispatch(newWorkActions.set(patch))
  const select = (id: string) => set({ worldIds: [...new Set([...form.worldIds, id])] })
  const changed = (msg: string) => { dispatch(sessionActions.dataChanged()); toast(msg) }

  return {
    policyAccepted,
    acceptPolicy: (ack: boolean) => ack ? setPolicyAccepted(true) : toast('정책 확인 항목에 동의해 주세요'),
    form, set, worlds,
    toggleWorld: (id: string, on: boolean) => set({ worldIds: on ? [...new Set([...form.worldIds, id])] : form.worldIds.filter((x) => x !== id) }),
    setCast: (i: number, key: 'n' | 'd', v: string) => set({ cast: form.cast.map((c, n) => n === i ? { ...c, [key]: v } : c) }),
    addTag: (raw: string) => {
      const tag = raw.trim().replace(/^#+/, '').trim()
      if (!tag) { toast('태그를 입력해 주세요'); return false }
      if (form.tags.some((v) => v.toLocaleLowerCase() === tag.toLocaleLowerCase())) { toast('이미 추가된 태그예요'); return false }
      set({ tags: [...form.tags, tag] })
      return true
    },
    removeTag: (tag: string) => set({ tags: form.tags.filter((t) => t !== tag) }),
    createWorld: async (f: WorldForm) => {
      const r = await libraryUseCase.createWorld(f)
      if ('error' in r) { toast(r.error); return false }
      select(r.id)
      changed('비공개 세계관을 만들었어요 (데모)')
      return true
    },
    combine: async (name: string, picks: { worldId: string; ruleIndex: number }[]) => {
      const r = await libraryUseCase.combineWorlds(name, picks)
      if ('error' in r) { toast(r.error); return false }
      select(r.id)
      changed('선택한 항목으로 비공개 세계관을 만들었어요 (데모)')
      return true
    },
    editWorld: async (id: string, f: WorldForm) => {
      let r = await libraryUseCase.editWorld(id, f, false)
      if ('needsConfirm' in r) {
        if (!window.confirm('제거한 규칙을 연결된 작품에도 반영할까요? 이전 세계관 이력에서 복원할 수 있어요.')) return
        r = await libraryUseCase.editWorld(id, f, true)
      }
      if ('error' in r) return toast(r.error)
      changed('세계관을 저장하고 새 이력을 남겼어요 (데모)')
    },
    restore: async (id: string, version: number) => {
      if (!window.confirm('선택한 버전을 복원하고 새 이력으로 남길까요?')) return
      if (!await libraryUseCase.restoreWorld(id, version, false)) {
        if (!window.confirm('제거한 규칙을 연결된 작품에도 반영할까요? 이전 세계관 이력에서 복원할 수 있어요.')) return
        await libraryUseCase.restoreWorld(id, version, true)
      }
      changed('선택한 버전을 복원했어요 (데모)')
    },
    togglePublic: async (id: string, isPublic: boolean) => {
      if (!isPublic && !window.confirm('이 세계관을 공개하고 이용을 허락할 권리가 있나요?')) return
      await libraryUseCase.togglePublic(id)
      changed('세계관 공개 상태를 변경했어요 (데모)')
    },
    setRulePublic: async (id: string, index: number, on: boolean) => {
      await libraryUseCase.setRulePublic(id, index, on)
      changed('세계관의 항목 공개 범위를 변경했어요 (데모)')
    },
    /** false를 돌려주면 화면이 체크를 되돌립니다. */
    setPermission: async (id: string, key: WorldPermission, on: boolean) => {
      if (on && !window.confirm('이 범위를 허용할 권리가 있나요?')) return
      await libraryUseCase.setPermission(id, key, on)
      changed('세계관 허용 범위를 저장했어요 (데모)')
    },
    use: (id: string) => {
      if (!form.worldIds.includes(id) && form.worldIds.length === 5) return toast('세계관은 최대 5개까지 연결할 수 있어요')
      select(id)
    },
    copy: async (id: string) => {
      if (!window.confirm('공개 세계관을 복사하면 이후 원본 변경은 반영되지 않아요. 계속할까요?')) return
      const r = await libraryUseCase.copyWorld(id)
      if (!r) return
      select(r.id)
      changed('공개 세계관을 내 세계관으로 복사했어요 (데모)')
    },
    remove: async (id: string) => {
      const linked = await libraryUseCase.deleteWorld(id, true)
      if ('error' in linked) return toast(linked.error)
      if (!window.confirm('이 세계관을 삭제할까요?')) return
      await libraryUseCase.deleteWorld(id)
      set({ worldIds: form.worldIds.filter((x) => x !== id) })
      changed('세계관을 삭제했어요 (데모)')
    },
    create: async () => {
      const r = await libraryUseCase.createWork(form)
      if ('error' in r) return toast(r.error)
      dispatch(newWorkActions.created())
      dispatch(sessionActions.dataChanged())
      toast('소설을 만들었어요 · 나만 보기 상태예요')
      navigate('/studio/' + r.id)
    },
  }
}
