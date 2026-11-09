import { useEffect } from 'react'
import { isFreeRelation, relationLabel } from '../../../../domain/entities/studioRelations'
import { useRelationPairViewModel } from '../viewmodel/useRelationPairViewModel'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>

export function RelationPairEditor(
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
        <button type='button' className='btn' onClick={() => { if (studio.confirmRelationDiscard()) onClose() }}>취소</button>
      </div>
      <p className='small muted'>
        적용 후 세계관 저장 버튼을 눌러야 저장됩니다. 취소하면 이 패널에서 입력한 변경만 버립니다.
      </p>
    </>
  )
}
