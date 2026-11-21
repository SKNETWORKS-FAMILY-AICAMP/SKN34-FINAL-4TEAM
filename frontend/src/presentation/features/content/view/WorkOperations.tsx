import { useEffect, useRef, useState } from 'react'
import type { Work } from '../../../../domain/entities/content'
import { Go } from '../../../shared/Go'
import type { WorkEditing } from './WorkOverview'

/**
 * 운영 설정 탭의 분기 정책 카드(원작). 모든 탭 위에 있던 것을 탭으로 옮겼다(고른 탭의 내용이 첫 화면 안에서 시작하도록).
 * 편집 상태(editing)는 히어로와 나눠 쓰는 호출 측(WorkManagement)의 것이라, 히어로에서 작품 정보·표지를 편집하는 동안은 이 카드의 편집이 잠기고 그 반대도 같다.
 * 분기 정책 폼은 이 탭 안에서만 열리므로, 폼이 열려 있는 동안은 호출 측이 다른 탭으로 옮기지 못하게 잠근다.
 */
export function WorkPolicy({ work: w, locked, editing, onEditingChange, onSave }: {
  work: Work
  /** 요청·표지 전송 중에는 편집을 시작하거나 저장하지 못한다. */
  locked: boolean
  editing: WorkEditing
  onEditingChange: (next: WorkEditing) => void
  onSave: (allowFork: boolean, allowForkPublication: boolean) => Promise<boolean>
}) {
  const editButton = useRef<HTMLButtonElement>(null)
  const closed = useRef(false)
  // 저장·취소로 폼이 사라지면 편집을 연 버튼으로 초점을 돌려 키보드 위치를 잃지 않게 한다.
  useEffect(() => {
    if (editing !== null || !closed.current) return
    editButton.current?.focus()
    closed.current = false
  }, [editing])
  const close = () => {
    closed.current = true
    onEditingChange(null)
  }
  return (
    <section className='tcard ep-card' aria-labelledby='ep-policy-title'>
      <div className='ep-sec-head'>
        <h3 id='ep-policy-title'>분기 정책</h3>
        {editing !== 'policy' && (
          <button ref={editButton} type='button' className='btn sm' disabled={locked || editing !== null} onClick={() => onEditingChange('policy')}>
            분기 정책 편집
          </button>
        )}
      </div>
      {editing === 'policy'
        ? <PolicyForm key={w.revision} work={w} locked={locked} onSave={onSave} onClose={close} />
        : (
          <dl className='ep-facts'>
            <div>
              <dt>분기 만들기</dt>
              <dd>{w.allowFork ? '허용' : '허용 안 함'}</dd>
            </div>
            <div>
              <dt>분기 작품 최초 공개</dt>
              <dd>{w.allowForkPublication ? '허용' : '허용 안 함'}</dd>
            </div>
          </dl>
        )}
    </section>
  )
}

/**
 * 운영 설정 탭의 포크 정보 카드(분기 작품): 분기 기준·방향과 한 줄 동작 영역(왼쪽 원작으로 가기(보조), 공개 중일 때만 공개 중단, 오른쪽 끝 위험 외곽선 삭제).
 * 공개 중단은 작품을 다시 읽어 revision이 오르고 편집 폼이 새로 시작하므로, 편집 중에는(blocked) 잠가 저장하지 않은 입력이 사라지지 않게 한다. 삭제도 같다.
 */
export function ForkInfo({ source, isPublic, blocked, onStopFork, onDeleteWork }: {
  source: NonNullable<Work['source']>
  /** 공개 중일 때만 '포크 공개 중단'이 있다. */
  isPublic: boolean
  blocked: boolean
  onStopFork: () => Promise<boolean>
  onDeleteWork: () => Promise<boolean>
}) {
  return (
    <section className='tcard ep-card' aria-labelledby='ep-fork-title'>
      <div className='ep-sec-head'>
        <h3 id='ep-fork-title'>포크 정보</h3>
      </div>
      <dl className='ep-facts'>
        <div>
          <dt>원작</dt>
          <dd>{`「${source.title}」 ${source.episode}화 · 버전 ${source.version}에서 분기`}</dd>
        </div>
        {source.direction && (
          <div>
            <dt>분기 방향</dt>
            <dd>{source.direction}</dd>
          </div>
        )}
      </dl>
      <div className='ep-card-actions'>
        {source.deleted
          ? <p className='small muted'>삭제된 원작이라 이동할 수 없어요.</p>
          : <Go to={`/work/${source.workId}`} className='btn sm'>원작으로 가기</Go>}
        {isPublic && <button type='button' className='btn sm' disabled={blocked} onClick={() => void onStopFork()}>포크 공개 중단</button>}
        <button type='button' className='btn sm ep-danger' disabled={blocked} onClick={() => void onDeleteWork()}>포크 삭제</button>
      </div>
    </section>
  )
}

/**
 * 운영 설정 탭 맨 아래의 위험 구역(원작): 작품 전체를 지우는 동작은 분기 정책과 섞지 않고 따로 둔다. 편집 중에는(blocked) 잠가 저장하지 않은 입력을 잃지 않게 한다.
 * 확인 절차는 호출 측(useEpisodeViewModel.deleteWork)이 맡는다.
 */
export function WorkDelete({ blocked, onDelete }: { blocked: boolean; onDelete: () => Promise<boolean> }) {
  return (
    <section className='ep-delete' aria-labelledby='ep-delete-title'>
      <div className='ep-sec-head'>
        <h3 id='ep-delete-title'>작품 삭제</h3>
        <button type='button' className='btn sm ep-danger' disabled={blocked} onClick={() => void onDelete()}>작품 삭제</button>
      </div>
      <p className='small muted'>서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 이 작품에서 만들어진 포크는 유지돼요.</p>
    </section>
  )
}

function PolicyForm({ work, locked, onSave, onClose }: { work: Work; locked: boolean; onSave: (allowFork: boolean, allowForkPublication: boolean) => Promise<boolean>; onClose: () => void }) {
  const [allowFork, setAllowFork] = useState(work.allowFork)
  const [allowPublication, setAllowPublication] = useState(work.allowForkPublication)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const changed = allowFork !== work.allowFork || allowPublication !== work.allowForkPublication
  return (
    <form
      className='ep-edit'
      aria-label='분기 정책 편집'
      onSubmit={async (e) => {
        e.preventDefault()
        if (await onSave(allowFork, allowPublication)) onClose()
      }}
    >
      <fieldset disabled={locked}>
        <label className='ep-check'>
          <input ref={first} type='checkbox' checked={allowFork} onChange={(e) => setAllowFork(e.target.checked)} /> 분기 만들기 허용
        </label>
        <label className='ep-check'>
          <input type='checkbox' checked={allowPublication} onChange={(e) => setAllowPublication(e.target.checked)} /> 분기 작품 최초 공개 허용
        </label>
        <p className='small muted'>
          생성 허용과 공개 허용은 별개예요. 공개 허용을 철회해도 이미 공개한 분기는 계속 연재할 수 있어요.
        </p>
        <div className='ep-edit-actions'>
          <button className='btn pri sm' disabled={!changed}>저장</button>
          <button type='button' className='btn sm' onClick={onClose}>취소</button>
        </div>
      </fieldset>
    </form>
  )
}
