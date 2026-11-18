import { useEffect, useId, useRef } from 'react'
import type { RelationDraftRow } from '../../../../domain/entities/relationDraft'
import { isFreeRelation, relationLabel } from '../../../../domain/entities/studioRelations'
import { RELATION_FROM_ERROR, relationFromDelayedNote } from '../../../../domain/entities/studioWorld'
import { useRelationPairViewModel } from '../viewmodel/useRelationPairViewModel'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>
type Pair = ReturnType<typeof useRelationPairViewModel>

/**
 * 관계 행의 'N화부터' 칸(DEC-54 2단계, 소설을 연결한 세계관만). 이 관계의 내용이 보이기 시작하는 회차이고 적용하려면 1 이상의 정수가 있어야 한다. 기존 관계는 서버가 준 시작 회차가 채워져 있다.
 * 잘못된 값은 칸을 `aria-invalid`로 두고 이유를 칸의 설명(`aria-describedby`)으로 잇는다. 공개 회차 입력처럼 숫자만 받는다.
 * 이미 기록된 시작 회차보다 늦춘 값은 막지 않고, 서버가 기존 연결을 남겨 독자에게는 기록된 회차부터 보인다는 사실을 같은 방식으로 칸 아래에서 알린다.
 */
function FromEpisode({ field, row, vm }: { field: string; row: RelationDraftRow; vm: Pair }) {
  const id = useId(), invalid = vm.fromInvalid(row), delayed = vm.fromDelayed(row)
  return (
    <>
      <label className='relationship-from'>
        {field} 시작 회차
        <input
          type='text'
          inputMode='numeric'
          pattern='[0-9]*'
          autoComplete='off'
          className='inp'
          aria-invalid={invalid}
          aria-describedby={`${invalid ? `${id}-error ` : ''}${delayed !== undefined ? `${id}-delayed ` : ''}${id}-help`}
          value={row.value.fromEpisode ?? ''}
          onChange={(e) => vm.writeFrom(row, e.target.value)}
        />
        화부터
      </label>
      {invalid && <p id={`${id}-error`} className='small world-field-error'>{RELATION_FROM_ERROR}</p>}
      {delayed !== undefined && <p id={`${id}-delayed`} role='status' className='small relationship-from-note'>{relationFromDelayedNote(delayed)}</p>}
      <p id={`${id}-help`} className='small muted'>
        이 내용을 이 회차의 기록으로 저장해요. 같은 회차에 다시 저장하면 그 회차의 기록을 고쳐요.
      </p>
    </>
  )
}

export function RelationPairEditor(
  { studio, source, target, focusRequest, onClose, onDirty }: {
    studio: VM
    source: string
    target: string
    focusRequest?: { id: string; seq: number } | null
    onClose: () => void
    onDirty?: (dirty: boolean) => void
  },
) {
  const focusedRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusRequest) return
    // 고칠 칸(잘못된 N화부터)이 있으면 그 칸에, 없으면 행의 첫 칸에 초점을 둔다.
    const frame = requestAnimationFrame(() => {
      const row = focusedRow.current
      ;(row?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? row?.querySelector<HTMLElement>('input,textarea,select'))?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest])
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
          if(r.value.predicate==='preserved_emotion_symmetric')return <div className='relationship-row' key={r.key}><p>두 설정 사이의 대칭 감정 · 읽기 전용</p><p>{r.value.title}</p><p className='world-prose'>{r.value.text}</p><p className='small muted'>현재 편집기는 방향별 감정만 수정할 수 있어요. 이 관계는 일반 저장 시 원형 그대로 보존돼요.</p></div>
          const field = label + ' ' + (i + 1)
          const direction = vm.direction(r)
          const write = (text: string) => vm.write(r, text)
          return (
            <div className='relationship-row' key={r.key} ref={r.value.id === focusRequest?.id ? focusedRow : undefined}>
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
              {studio.relationFrom && <FromEpisode field={field} row={r} vm={vm} />}
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
                        {r.value.predicate === 'parent_of' ? '부모' : '자녀'}예요.
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
  // 같은 사람의 다른 이름 카드(주체) → 본체 카드(대상). 인물 카드끼리만 잇고, 소설을 연결한 세계관은 행마다 N화부터를 정해야 적용돼요(#485, DEC-54).
  const identity = () => {
    const visible = rows.filter((r) => r.group === 'identity')
    return (
      <section className='relationship-group' key='identity'>
        <h4>동일 인물</h4>
        <p className='small muted'>
          같은 사람인 두 카드를 이어요. 다른 이름 카드에서 본체 카드로 이어지고, 이 관계를 기록한 회차부터 독자에게 정체가 드러나요.
        </p>
        {visible.map((r, i) => {
          const field = '동일 인물 ' + (i + 1)
          return (
            <div className='relationship-row' key={r.key}>
              <label className='field'>
                {field} 본체
                <select className='inp' value={r.value.targetId ?? ''} onChange={(e) => vm.setBody(r, e.target.value)}>
                  <option value={source}>{name(source)}</option>
                  <option value={target}>{name(target)}</option>
                </select>
              </label>
              <p className='small'>{name(r.value.subjectId)}은(는) {name(r.value.targetId)}의 다른 이름이에요.</p>
              {studio.relationFrom && <FromEpisode field={field} row={r} vm={vm} />}
              {studio.relationFrom && !vm.fromInvalid(r) && r.value.fromEpisode !== undefined && (
                <p className='small'>{r.value.fromEpisode}화부터 독자에게 정체가 드러나요.</p>
              )}
              {vm.bodyAuthorOnly(r) && (
                <p className='small muted'>
                  {name(r.value.targetId)}은(는) '작가 전용' 카드예요. 인물 지식에는 시점 제한이 없어 다른 인물이 본체를 알 수 있어요. 공개 회차를 정하면 그 회차 전에는 알지 못해요.
                </p>
              )}
              <button className='btn sm relationship-remove' type='button' onClick={() => vm.remove(r)}>{field} 삭제</button>
            </div>
          )
        })}
        {!visible.length && vm.identityAllowed && (
          <button className='btn sm' type='button' onClick={() => vm.add('identity', source, target)}>동일 인물 추가</button>
        )}
        {!visible.length && !vm.identityAllowed && <p className='small muted'>인물 카드끼리만 「동일 인물」로 이을 수 있어요.</p>}
        {!!visible.length && (
          <p className='small muted'>
            {!studio.relationFrom
              ? '소설을 연결하지 않은 세계관이라 1화 기준으로 기록돼요.'
              : studio.identityEpisode === null
              ? '「동일 인물」을 지우려면(끝내려면) 이 패널을 닫고 위의 "관계 기준" 칸에서 끝낼 회차를 정한 뒤 다시 열어 주세요.'
              : `「동일 인물」을 지우면 ${studio.identityEpisode}화에서 끝나요.`}
          </p>
        )}
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
        않아요.
      </p>
      {group('fact', source, target, '실제 관계')}
      {group('emotion', source, target, `${name(source)} → ${name(target)} 감정`)}
      {group('emotion', target, source, `${name(target)} → ${name(source)} 감정`)}
      {identity()}
      {!!removed.length && (
        <p role='status'>
          관계 항목 {removed.length}개를 삭제할 예정이에요. 다른 관계와 감정은 유지돼요.
        </p>
      )}
      {error && <p role='alert' className='world-error'>{studio.error || error}</p>}
      <div className='relationship-apply'>
        <button type='button' className='btn pri' onClick={vm.apply}>편집본에 적용</button>
        <button type='button' className='btn' onClick={() => { if (studio.confirmRelationDiscard()) onClose() }}>취소</button>
      </div>
      <p className='small muted'>
        적용 후 세계관 저장 버튼을 눌러야 저장돼요. 취소하면 이 패널에서 입력한 변경만 버려요.
      </p>
    </>
  )
}
