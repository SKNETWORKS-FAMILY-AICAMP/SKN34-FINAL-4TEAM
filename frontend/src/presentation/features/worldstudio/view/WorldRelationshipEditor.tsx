import { CharacterRelationshipEditor } from './CharacterRelationshipEditor'
import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'
import { useState } from 'react'
import { PersonDeletionConfirm } from './PersonDeletionConfirm'
import { RelationPairEditor } from './RelationPairEditor'
import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>
export function WorldRelationshipEditor({ studio }: { studio: VM }) {
  return import.meta.env.MODE === 'mockup'
    ? <CharacterRelationshipEditor studio={studio}/>
    : <SettingsRelationshipEditor studio={studio}/>
}

function SettingsRelationshipEditor({ studio }: { studio: VM }) {
  const people = studio.editing!.settings.filter((s) =>
    cardTypes.some((type) => type.id === cardTypeOf(s.item))
  )
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [open, setOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const deletion = deleteConfirm ? studio.personDeletionInfo(deleteConfirm) : null
  const relations = studio.editing!.settings.filter((s) => s.item.kind === 'relation')
  const name = (id: string | null) =>
    people.find((s) => s.item.id === id)?.item.title || '선택 안 함'
  return (
    <section aria-label='관계 편집'>
      <h3>관계 연결 (선택)</h3>
      <p>구조적 관계와 방향별 감정을 따로 작성합니다.</p>
      <fieldset className='world-fields' disabled={studio.busy}>
        <legend className='sr-only'>관계 대상 선택</legend>
        <div className='world-form-row'>
          <label className='field'>
            source · 관계 주체<select
              className='inp'
              value={source}
              onChange={(e) => {
                setSource(e.target.value)
                setOpen(false)
              }}
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
              onChange={(e) => {
                setTarget(e.target.value)
                setOpen(false)
              }}
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
                const id = studio.undoPersonDeletion()
                if (id) setSource(id)
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
              if (studio.deletePerson(deletion.person.item.id)) {
                setDeleteConfirm(null)
                setSource('')
                setTarget('')
                setOpen(false)
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
              onClick={() => {
                setSource(s.item.subjectId ?? '')
                setTarget(s.item.targetId ?? '')
                setOpen(true)
              }}
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
            onClose={() => setOpen(false)}
          />
        )}
      </fieldset>
    </section>
  )
}
