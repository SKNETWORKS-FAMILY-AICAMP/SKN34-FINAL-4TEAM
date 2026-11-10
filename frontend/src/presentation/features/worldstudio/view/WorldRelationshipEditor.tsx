import CharacterCards from './CharacterCards'
import { buildSettingRelationshipMap } from '../viewmodel/characterMap'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import './world-map.css'
import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PersonDeletionConfirm } from './PersonDeletionConfirm'
import { RelationPairEditor } from './RelationPairEditor'
import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>
export function WorldRelationshipEditor({ studio }: { studio: VM }) {
  const map = useWorldMapViewModel(studio.editing!.settings, buildSettingRelationshipMap)
  const [choosing, setChoosing] = useState(false)
  const section = useRef<HTMLElement>(null), cancelConnect = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef('')
  useEffect(() => {
    if (choosing) cancelConnect.current?.focus()
    else if (returnFocus.current) {
      section.current?.querySelector<HTMLButtonElement>(`[data-id="${returnFocus.current}"] button[aria-label$="관계 연결"]`)?.focus()
      returnFocus.current = ''
    }
  }, [choosing])
  const [layoutVersion, setLayoutVersion] = useState(0)
  const people = studio.editing!.settings.filter((s) =>
    cardTypes.some((type) => type.id === cardTypeOf(s.item))
  )
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [open, setOpen] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null)
  const handledRequest = useRef(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const validDeletion = !!deleteConfirm && people.some((s) =>
    s.item.id === deleteConfirm && s.item.kind === 'entity' && s.item.entityType === 'character'
  )
  const deletion = deleteConfirm && validDeletion ? studio.personDeletionInfo(deleteConfirm) : null
  useEffect(() => { if (deleteConfirm && !validDeletion) setDeleteConfirm(null) }, [deleteConfirm, validDeletion])
  const selectPair = useCallback((nextSource: string, nextTarget: string, nextOpen: boolean) => {
    // 열린 패널과 같은 두 인물(방향 무관)을 다시 고르면 작성 중인 초안을 그대로 둔다.
    if (open && nextOpen && nextSource === target && nextTarget === source) return true
    if (open && (nextSource !== source || nextTarget !== target) && !studio.confirmRelationDiscard()) return false
    setSource(nextSource)
    setTarget(nextTarget)
    setOpen(nextOpen)
    setChoosing(false)
    map.select(nextSource || null)
    return true
  }, [open, source, target, studio])
  useEffect(() => {
    const request = studio.relationRequest
    if (!request || request.seq === handledRequest.current) return
    handledRequest.current = request.seq
    const item = studio.editing?.settings.find((row) => row.item.id === request.id && row.item.kind === 'relation')?.item
    if (!item?.subjectId || !item.targetId) return
    const samePair = open && (item.subjectId === source && item.targetId === target || item.subjectId === target && item.targetId === source)
    if (samePair || selectPair(item.subjectId, item.targetId, true)) setFocusRequest(request)
  }, [studio.relationRequest, studio.editing?.settings, open, source, target, selectPair])
  const stopChoosing = () => { returnFocus.current = source; setChoosing(false) }
  const relations = studio.editing!.settings.filter((s) => s.item.kind === 'relation')
  const name = (id: string | null) =>
    people.find((s) => s.item.id === id)?.item.title || '선택 안 함'
  return (
    <section ref={section} className='world-map relationship-editor' aria-label='관계 편집' onKeyDown={(e) => { if (choosing && e.key === 'Escape') stopChoosing() }}>
      <h3>관계 연결 (선택)</h3>
      <p>구조적 관계와 방향별 감정을 따로 작성합니다.</p>
      <fieldset className='world-fields' disabled={studio.busy}>
        <legend className='sr-only'>관계 대상 선택</legend>
        <div className='relationship-toolbar'>
          <button className='btn pri' type='button' onClick={()=>{if(!studio.confirmRelationDiscard())return;const id=studio.addCard('character');if(id)studio.editCard(id)}}>인물 추가</button>
          <button className='btn' type='button' onClick={()=>setLayoutVersion(v=>v+1)}>배치 정돈</button>
        </div>
        <div className='relationship-hint' role='status'>{choosing?<>{name(source)}의 연결 상대를 고르세요.<button ref={cancelConnect} className='btn sm' type='button' onClick={stopChoosing}>연결 취소</button></>:'카드를 선택해 정보를 편집하거나 관계를 연결하세요. 실선은 구조 관계, 점선은 감정입니다. 위치는 저장되지 않습니다.'}</div>
        <div className='relationship-service-layout'>
        <CharacterCards key={layoutVersion} vm={map} editing={{busy:studio.busy,selectedRelations:open?studio.editing!.settings.filter(s=>s.item.kind==='relation'&&((s.item.subjectId===source&&s.item.targetId===target)||(s.item.subjectId===target&&s.item.targetId===source))).map(s=>s.item.id):[],targetSource:choosing?source:null,onSelect:id=>{if(choosing){selectPair(source,id,true)}else if(studio.confirmRelationDiscard()){studio.editCard(id)}},onConnect:id=>{if(selectPair(id,'',false))setChoosing(true)},onRelation:id=>studio.editRelation(id)}}/>
        <div className='relationship-service-form'>
        <div className='world-form-row'>
          <label className='field'>
            source · 관계 주체<select
              className='inp'
              value={source}
              onChange={(e) => selectPair(e.target.value, target, false)}
            >
              <option value=''>선택하세요</option>
              {people.map((s) => (
                <option key={s.item.id} value={s.item.id}>
                  {s.item.title || '이름 없는 설정'}
                </option>
              ))}
            </select>
          </label>
          <label className='field'>
            target · 관계 대상<select
              className='inp'
              value={target}
              onChange={(e) => selectPair(source, e.target.value, false)}
            >
              <option value=''>선택하세요</option>
              {people.map((s) => (
                <option key={s.item.id} value={s.item.id}>
                  {s.item.title || '이름 없는 설정'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className='btn'
          type='button'
          disabled={!source || !target || source === target}
          onClick={() => setOpen(true)}
        >
          관계 작성
        </button>
        {people.length < 2 && (
          <p>설정 카드에서 설정 두 개을 먼저 추가하세요. 관계 없이도 저장할 수 있습니다.</p>
        )}
        <div className='world-toolbar'>
          <button
            className='btn'
            type='button'
            disabled={!people.some((s) =>
              s.item.id === source && s.item.entityType === 'character'
            )}
            onClick={() => setDeleteConfirm(source)}
          >
            선택한 인물 삭제
          </button>
          {studio.canUndoPersonDeletion && (
            <button
              className='btn'
              type='button'
              onClick={() => {
                if (open && !studio.confirmRelationDiscard()) return
                const id = studio.undoPersonDeletion()
                if (id) { setSource(id); setOpen(false); setChoosing(false) }
              }}
            >
              인물 삭제 되돌리기
            </button>
          )}
        </div>
        {deletion && (
          <PersonDeletionConfirm
            deletion={deletion}
            onDelete={() => {
              if (open && !studio.confirmRelationDiscard()) return
              if (studio.deletePerson(deletion.person.item.id)) {
                setDeleteConfirm(null)
                setSource('')
                setTarget('')
                setOpen(false)
                setChoosing(false)
              }
            }}
            onCancel={() => setDeleteConfirm(null)}
          />
        )}
        {!relations.length && <p>아직 연결한 관계가 없습니다.</p>}
        <nav aria-label='저장할 관계 목록'>
          {relations.map((s) => (
            <button
              className='btn'
              key={s.item.id}
              type='button'
              onClick={() => selectPair(s.item.subjectId ?? '', s.item.targetId ?? '', true)}
            >
              {name(s.item.subjectId)} · {relationLabel(s.item)} · {name(s.item.targetId)}
            </button>
          ))}
        </nav>
        {open && (
          <RelationPairEditor
            key={source + '|' + target}
            studio={studio}
            source={source}
            target={target}
            focusRequest={focusRequest}
            onClose={() => setOpen(false)}
          />
        )}
        </div>
        </div>
      </fieldset>
    </section>
  )
}
