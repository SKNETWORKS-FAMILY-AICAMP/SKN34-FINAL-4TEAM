import { useId, useRef, type ReactNode } from 'react'

import { Go } from '../../../shared/Go'
import { PopMenu } from '../../../shared/PopMenu'
import { useImportTargets, type ImportOutcome, type ImportTarget } from '../viewmodel/useWorldImport'

/**
 * 가져오기 메뉴 안의 대상(내 세계관) 목록. 메뉴가 열려 있을 때만 그려지므로 그때 내 세계관을 읽고, 닫았다 열면 다시 읽는다.
 * 불러오는 중·실패(다시 시도)·대상 없음(세계관 만들기)을 실제 결과대로 따로 보이고, 대상이 있으면 그 길이 무엇을 하는지(`note`)를 먼저 알린다.
 * 안내 문단은 항목이 아니라 화면 읽기 프로그램이 지나치므로 id를 주어 메뉴의 설명(`PopMenu`)과 각 항목의 설명(`aria-describedby`)으로 읽히게 한다.
 */
function Targets({ sourceWorldId, note, item }: { sourceWorldId: string; note: string; item: (target: ImportTarget, noteId: string) => ReactNode }) {
  const noteId = useId()
  const { targets, isLoading, isError, retry } = useImportTargets(sourceWorldId)
  if (isLoading) return <p id={noteId} className="pop-menu-note" role="status">내 세계관을 불러오고 있어요.</p>
  if (isError || !targets) {
    return (
      <>
        <p id={noteId} className="pop-menu-note" role="alert">내 세계관을 불러오지 못했어요.</p>
        {/* 메뉴는 항목을 누르면 닫히므로, 닫히지 않고 이 자리에서 다시 읽도록 누름이 메뉴까지 올라가지 않게 한다. */}
        <button type="button" role="menuitem" aria-describedby={noteId} onClick={(e) => { e.stopPropagation(); retry() }}>다시 시도</button>
      </>
    )
  }
  if (!targets.length) {
    return (
      <>
        <p id={noteId} className="pop-menu-note">설정을 가져갈 내 세계관이 아직 없어요.</p>
        <Go to="/worldstudio" role="menuitem" aria-describedby={noteId}>세계관 만들기</Go>
      </>
    )
  }
  return <><p id={noteId} className="pop-menu-note">{note}</p>{targets.map((target) => item(target, noteId))}</>
}

/**
 * 설정 가져오기(DEC-46)의 진입점. 고른 설정을 내 세계관 초안에 **바로** 더하는 메뉴: 대상(내 세계관)을 고르면 `onAdd`가 그 자리에서 추가하고 화면은 옮기지 않는다. 관계는 함께 오지 않는다.
 * 고른 설정이 없으면(`unavailable`) 내 세계관을 읽지 않고 그 사유만 보이고, 추가하는 동안(`saving`)에는 대상을 다시 고를 수 없다.
 * 항목을 고르면 메뉴가 닫히고 초점은 이 버튼에 남는다. 진행·결과는 옆의 `ImportOutcomeNotice`가 알린다.
 */
export function WorldAddMenu({ sourceWorldId, label, note, unavailable, saving, onAdd }: {
  sourceWorldId: string; label: string; note: string; unavailable?: string; saving: boolean; onAdd: (target: ImportTarget) => void
}) {
  const reasonId = useId()
  return (
    <PopMenu className="worlds-import" label={label} icon={label}>
      {unavailable
        ? <p id={reasonId} className="pop-menu-note">{unavailable}</p>
        : <Targets sourceWorldId={sourceWorldId} note={note} item={({ id, name }, noteId) => <button key={id} type="button" role="menuitem" aria-describedby={noteId} disabled={saving} onClick={() => onAdd({ id, name })}>{name}</button>} />}
    </PopMenu>
  )
}

/**
 * 바로 추가의 진행·결과: 추가하는 중, 추가함(초안에 비공개로 들어갔고 공개·독자 공개는 그 세계관에서 정해 확정해야 한다는 사실과 관리 화면 링크), 실패(서버·검증 사유 그대로 + 다시 시도).
 * 실패를 성공으로 보이지 않는다. '다시 시도'를 누르면 그 버튼이 사라지므로 초점을 이 안내 영역으로 옮겨 둔다.
 */
export function ImportOutcomeNotice({ outcome, onRetry }: { outcome?: ImportOutcome; onRetry: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const name = outcome && `「${outcome.target.name}」`
  return (
    <div ref={box} className="worlds-import-result" tabIndex={-1}>
      {outcome?.status === 'saving' && <p role="status">{name} 초안에 설정 {outcome.count}개를 추가하고 있어요…</p>}
      {outcome?.status === 'done' && (
        <p role="status">
          {name} 초안에 설정 {outcome.count}개를 추가했어요. 비공개로 들어가요. 그 세계관에서 공개 범위를 정하고 확정 버전을 남겨야 다른 사람에게 보여요.{' '}
          <Go to={`/worldstudio/${outcome.target.id}`}>{name} 관리 화면 열기</Go>
        </p>
      )}
      {outcome?.status === 'failed' && (
        <p role="alert">
          {name}에 추가하지 못했어요. {outcome.message}{' '}
          <button type="button" className="btn sm" onClick={() => { box.current?.focus(); onRetry() }}>다시 시도</button>
        </p>
      )}
    </div>
  )
}
