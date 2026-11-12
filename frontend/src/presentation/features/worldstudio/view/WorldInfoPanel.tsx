import { useEffect, useId, useRef, useState } from 'react'

import { worldCoverError, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { AiCoverButton } from '../../../shared/AiCoverButton'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { PublishFields } from './WorldPublishFields'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 관리 모드 헤더의 세계관 정보 편집 패널(/content 작품 정보 편집과 같은 ep-edit 틀, 헤더의 소개 자리에 열린다). 이름·설명·공개 범위·장르·표지를 한 곳에서 고치고 저장·취소한다.
 * 저장은 바뀐 것만 이 순서로 보낸다: 이름·설명은 기존 초안 저장, 공개 범위·장르는 기존 공개 설정(`vm.setPublication`, 공개로 바꿀 때만 한 번 확인), 표지는 고른 이미지 올리기(교체 포함)다.
 * 하나라도 실패하면 닫지 않고 오류를 알리며 입력을 그대로 둬 남은 것만 다시 저장할 수 있다. 취소·Esc는 입력과 고른 표지를 모두 버린다.
 * 표지 삭제만은 확인한 뒤 바로 지운다. 표지 'AI로 생성'은 연결 전이라 비활성이다.
 * 저장하지 않은 수정이 있으면(`vm.infoLocked`) 그 수정이 이름·설명 저장에 딸려 가지 않도록 저장을 잠그고 먼저 저장하라고 알린다.
 */
export function WorldInfoPanel({ vm, world, onClose }: { vm: VM; world: StudioWorld; onClose: () => void }) {
  const [name, setName] = useState(world.name)
  const [description, setDescription] = useState(world.description)
  const [publication, setPublication] = useState(vm.publication)
  const [cover, setCover] = useState<File>()
  const [coverProblem, setCoverProblem] = useState('')
  const first = useRef<HTMLInputElement>(null)
  const lockId = useId()
  useEffect(() => { first.current?.focus() }, [])
  const infoChanged = name.trim() !== world.name || description !== world.description
  const publicationChanged = publication.visibility !== vm.publication.visibility || publication.genre !== vm.publication.genre
  const canSave = (infoChanged || publicationChanged || !!cover) && !!name.trim() && !vm.infoLocked
  const save = async () => {
    if (!canSave) return
    if (infoChanged && !(await vm.saveInfo(name.trim(), description))) return
    if (publicationChanged && !(await vm.setPublication(publication))) return
    if (cover && !(await vm.setCover(cover))) return
    onClose()
  }
  // 형식·크기가 맞지 않는 파일은 고르는 순간 이유를 알리고 받지 않는다.
  const pickCover = (file: File | undefined) => {
    if (!file) return
    const problem = worldCoverError(file)
    setCoverProblem(problem ?? '')
    setCover(problem ? undefined : file)
  }
  return (
    <form
      className="ep-edit world-info-edit"
      aria-label="세계관 정보 편집"
      onSubmit={(e) => { e.preventDefault(); void save() }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !vm.busy) onClose() }}
    >
      <fieldset disabled={vm.busy}>
        <label>세계관 이름<input ref={first} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></label>
        <label>세계관 설명<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={20000} rows={4} /></label>
        <fieldset className="world-publish world-compact">
          <legend className="sr-only">공개 설정</legend>
          <PublishFields value={publication} onChange={(change) => setPublication((current) => ({ ...current, ...change }))} />
          <p className="small muted">저장을 누르면 적용돼요. 읽는 사람은 공개한 세계관의 설정 카드와 인물 관계를 읽기만 할 수 있어요.</p>
        </fieldset>
        <div className="world-cover-edit" role="group" aria-label="표지">
          <span className="world-cover-label">표지</span>
          <div className="ep-cover-pick">
            <label className="btn sm ep-file-pick">
              이미지 선택
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!vm.supportsCover} onChange={(e) => pickCover(e.target.files?.[0])} />
            </label>
            <AiCoverButton />
            {vm.supportsCover && world.hasCover && (
              <button type="button" className="btn sm" onClick={() => { if (window.confirm('표지를 삭제할까요? 자동으로 만든 표지로 돌아가요.')) void vm.setCover(null) }}>표지 삭제</button>
            )}
          </div>
          {cover
            ? <div className="ep-file-chosen"><span>{`선택한 파일: ${cover.name}`}</span></div>
            : <p className="small muted">{vm.supportsCover ? 'PNG·JPEG·WebP, 5 MiB 이하. 올리지 않으면 자동으로 만든 표지를 써요. 공개 목록에는 확정 버전을 남긴 공개 세계관의 표지로 보여요.' : '데모에서는 표지 업로드를 지원하지 않아요.'}</p>}
          {coverProblem && <p role="alert" className="small">{coverProblem}</p>}
          {vm.coverAction && <p role="status" className="small muted">{vm.coverAction === 'upload' ? '표지를 올리고 있어요…' : '표지를 지우고 있어요…'}</p>}
          {vm.cover.error && <p className="small muted">{vm.cover.error}</p>}
        </div>
        {vm.infoLocked && <p id={lockId} role="status" className="small muted">작성 중인 변경을 먼저 저장하세요.</p>}
        <div className="ep-edit-actions">
          <button className="btn pri sm" disabled={!canSave} aria-describedby={vm.infoLocked ? lockId : undefined}>{vm.saveState === 'saving' ? '저장 중…' : '저장'}</button>
          <button type="button" className="btn sm" onClick={onClose}>취소</button>
        </div>
      </fieldset>
    </form>
  )
}
