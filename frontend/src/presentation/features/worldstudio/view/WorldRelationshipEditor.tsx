import { CharacterRelationshipEditor } from './CharacterRelationshipEditor'
import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'
import { useEffect, useState } from 'react'
import { PersonDeletionConfirm } from './PersonDeletionConfirm'
import { isFreeRelation, relationLabel } from '../../../../domain/entities/studioRelations'
import { useRelationPairViewModel } from '../viewmodel/useRelationPairViewModel'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>
export function WorldRelationshipEditor({ studio }: { studio: VM }) {
  return import.meta.env.MODE === 'mockup'
    ? <CharacterRelationshipEditor studio={studio} renderPair={(source,target,onClose,onDirty)=><PairEditor key={source+'|'+target} studio={studio} source={source} target={target} onClose={onClose} onDirty={onDirty}/>}/>
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
          <PairEditor
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

function PairEditor(
  { studio, source, target, onClose, onDirty }: {
    studio: VM
    source: string
    target: string
    onClose: () => void
    onDirty?: (dirty: boolean) => void
  },
) {
  const name = (id: string | null) =>
    studio.editing!.settings.find((s) => s.item.id === id)?.item.title || '새 설정'
  const vm = useRelationPairViewModel(studio, source, target, onClose)
  const { rows, removed, error, change } = vm
  useEffect(() => onDirty?.(vm.dirty), [onDirty, vm.dirty])
  const group = (kind: 'fact' | 'emotion', from: string, to: string, label: string) => {
    const visible = rows.filter((r) =>
      r.group === kind && (kind === 'fact' || r.value.subjectId === from)
    )
    return (
      <section className='relationship-group' key={label}>
        <h4>{label}</h4>
        {visible.map((r, i) => {
          const field = label + ' ' + (i + 1)
          const direction = vm.direction(r)
          const write = (text: string) => vm.write(r, text)
          return (
            <div className='relationship-row' key={r.key}>
              <label className='field'>
                {field}
                {kind === 'fact'
                  ? (
                    <input
                      className='inp'
                      list='relationship-examples'
                      value={r.value.text ?? ''}
                      maxLength={3000}
                      placeholder='예: 아버지와 서자, 인정받지 못한 가족'
                      onChange={(e) => write(e.target.value)}
                    />
                  )
                  : (
                    <textarea
                      className='ta'
                      value={r.value.text ?? ''}
                      maxLength={3000}
                      placeholder='예: 존경하고 인정받고 싶지만 차별에는 분노한다'
                      onChange={(e) => write(e.target.value)}
                    />
                  )}
              </label>
              {r.value.id && !isFreeRelation(r.value.predicate) && (
                <p className='small muted'>기존 관계: {relationLabel(r.value)}</p>
              )}
              {kind === 'fact' && (
                <>
                  <label className='field'>
                    {field} 방향<select
                      className='inp'
                      value={direction}
                      onChange={(e) => {
                        const way = e.target.value
                        vm.setDirection(
                          r,
                          way === 'mutual' ? 'mutual' : way === 'reverse' ? 'reverse' : 'forward',
                        )
                      }}
                    >
                      <option value='mutual'>두 사람 사이의 관계</option>
                      <option value='forward'>{name(source)} → {name(target)}</option>
                      <option value='reverse'>{name(target)} → {name(source)}</option>
                    </select>
                  </label>
                  {r.value.predicate === 'parent_of' || r.value.predicate === 'child_of'
                    ? (
                      <p className='small'>
                        {name(r.value.subjectId)}은(는) {name(r.value.targetId)}의{' '}
                        {r.value.predicate === 'parent_of' ? '부모' : '자녀'}입니다.
                      </p>
                    )
                    : (
                      <p className='small muted'>
                        {direction === 'mutual'
                          ? '두 사람의 관계를 자유롭게 적어 주세요.'
                          : `주체: ${name(r.value.subjectId)} · 대상: ${
                            name(r.value.targetId)
                          }. 누가 누구의 부모인지처럼 역할을 구체적으로 적어 주세요.`}
                      </p>
                    )}
                </>
              )}
              <label className='field'>
                {field} 여부<select
                  className='inp'
                  value={r.value.polarity}
                  onChange={(e) =>
                    change(r.key, {
                      polarity: e.target.value === 'denied' ? 'denied' : 'asserted',
                    })}
                >
                  <option value='asserted'>해당함</option>
                  <option value='denied'>해당하지 않음</option>
                </select>
              </label>
              {kind === 'emotion' && (
                <button
                  className='btn sm'
                  type='button'
                  onClick={() => vm.reverse(r)}
                >
                  {field} 방향 바꾸기
                </button>
              )}
              <details>
                <summary>항목 이름 직접 쓰기</summary>
                {r.value.title && <p className='small'>{r.value.title}</p>}
                <label className='field'>
                  {field} 이름<input
                    className='inp'
                    value={r.value.title ?? ''}
                    maxLength={200}
                    placeholder='관계에 맞춰 자동으로 정해요'
                    onChange={(e) => change(r.key, { title: e.target.value })}
                  />
                </label>
              </details>
              <button
                className='btn sm relationship-remove'
                type='button'
                onClick={() => vm.remove(r)}
              >
                {field} 삭제
              </button>
            </div>
          )
        })}
        <button className='btn sm' type='button' onClick={() => vm.add(kind, from, to)}>
          {label} 추가
        </button>
      </section>
    )
  }
  return (
    <>
      <datalist id='relationship-examples'>
        <option value='친구' />
        <option value='아버지와 서자, 인정받지 못한 가족' />
        <option value='오랜 동료이자 경쟁자' />
      </datalist>
      <p className='small muted'>
        실제 관계는 여러 개일 수 있어요. 감정은 각 방향을 따로 정하며, 반대 방향으로 복사하지
        않습니다.
      </p>
      {group('fact', source, target, '실제 관계')}
      {group('emotion', source, target, `${name(source)} → ${name(target)} 감정`)}
      {group('emotion', target, source, `${name(target)} → ${name(source)} 감정`)}
      {!!removed.length && (
        <p role='status'>
          관계 항목 {removed.length}개를 삭제할 예정입니다. 다른 관계와 감정은 유지됩니다.
        </p>
      )}
      {error && <p role='alert' className='world-error'>{studio.error || error}</p>}
      <div className='relationship-apply'>
        <button type='button' className='btn pri' onClick={vm.apply}>편집본에 적용</button>
        <button type='button' className='btn' onClick={onClose}>취소</button>
      </div>
      <p className='small muted'>
        적용 후 세계관 저장 버튼을 눌러야 저장됩니다. 취소하면 이 패널에서 입력한 변경만 버립니다.
      </p>
    </>
  )
}
