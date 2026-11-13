import { useEffect, useId, useRef, useState } from 'react'

import { cardTypes } from '../../../../domain/entities/studioCards'
import { plainCardText } from '../../../shared/cardSections'
import { BackChev } from '../../../shared/icons'
import { KindChip } from '../../../shared/KindChip'
import { Sheet } from '../../../shared/Sheet'
import { CARD_KIND } from '../../../shared/worldBoard'
import { importCards } from '../../../shared/importCards'
import { useImportableWorlds, useImportSource } from '../viewmodel/useWorldImport'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/** 단계가 바뀌면 누른 버튼이 사라지므로 새 단계의 영역으로 초점을 옮긴다(시트가 처음 열릴 때는 `data-autofocus`로 같은 곳에 간다). */
function useStepFocus() {
  const step = useRef<HTMLElement>(null)
  useEffect(() => { step.current?.focus() }, [])
  return step
}

/** 1단계: 공개 세계관 목록(대상 세계관 자신은 뺀다). 공개 설정이 없는 세계관은 가져올 것이 없어 고를 수 없다. */
function ImportWorlds({ targetId, pick }: { targetId: string; pick: (id: string) => void }) {
  const step = useStepFocus()
  const { worlds, shown, total, isLoading, retry } = useImportableWorlds(targetId)
  return (
    <section ref={step} tabIndex={-1} data-autofocus className="world-sheet-step" aria-label="가져올 세계관 고르기" aria-busy={isLoading}>
      {isLoading ? <p role="status">공개 세계관을 불러오고 있어요…</p>
        : !worlds ? <p role="alert">공개 세계관을 불러오지 못했어요. <button type="button" className="btn sm" onClick={retry}>다시 시도</button></p>
        : worlds.length ? (
          <>
            <ul className="world-pick-list">
              {worlds.map((world) => (
                <li key={world.id}>
                  <button type="button" disabled={!world.cardCount} onClick={() => pick(world.id)}>
                    <strong>{world.name}</strong>
                    <small>{world.authorNickname} · {world.cardCount ? `공개 설정 ${world.cardCount}개` : '공개 설정 없음'}</small>
                  </button>
                </li>
              ))}
            </ul>
            {total > shown && <p className="small muted">최근 공개한 세계관 {shown}개까지만 보여요.</p>}
          </>
        )
        : <p className="muted">가져올 수 있는 공개 세계관이 없어요.</p>}
    </section>
  )
}

/**
 * 2단계: 고른 세계관의 공개 설정을 체크해 초안에 더한다. 관계는 공개 상세가 준 것 가운데 같이 가져오는 카드 사이의 것만 고를 수 있고,
 * 관계를 불러오지 못한 응답(`unavailable`)이면 관계 포함을 끄고 이유를 알린다. 더하지 못하면(서버 한도 등) 이유를 보이고 시트를 닫지 않는다.
 * 체크박스의 이름은 유형과 설정 이름이고 본문 요약은 설명(`aria-describedby`)으로 잇는다(요약까지 이름에 넣으면 줄마다 본문 전체가 읽힌다). 일부만 고른 동안 `전체 선택`은 중간 상태다.
 */
function ImportCards({ vm, sourceId, back, done }: { vm: VM; sourceId: string; back: () => void; done: () => void }) {
  const step = useStepFocus()
  const { world, isLoading, retry } = useImportSource(sourceId)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [withRelations, setWithRelations] = useState(false)
  const [problem, setProblem] = useState('')
  const cards = world?.cards ?? []
  const picked = cards.filter((card) => checked.has(card.id))
  const relations = world?.relationshipStatus === 'current'
  const toggle = (id: string, on: boolean) => setChecked((current) => new Set(on ? [...current, id] : [...current].filter((other) => other !== id)))
  const summaryId = useId()
  const all = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (all.current) all.current.indeterminate = picked.length > 0 && picked.length < cards.length
  })
  const run = () => {
    if (!world) return
    try {
      if (vm.importSettings(importCards(world, new Set(picked.map((card) => card.id)), withRelations && relations))) done()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : '설정을 가져오지 못했어요.')
    }
  }
  return (
    <section ref={step} tabIndex={-1} data-autofocus className="world-sheet-step" aria-label="가져올 설정 고르기" aria-busy={isLoading}>
      <button type="button" className="btn sm" onClick={back}><BackChev />세계관 목록</button>
      {isLoading ? <p role="status">설정을 불러오고 있어요…</p>
        : world === undefined ? <p role="alert">세계관을 불러오지 못했어요. <button type="button" className="btn sm" onClick={retry}>다시 시도</button></p>
        : world === null ? <p role="alert">이 세계관을 찾을 수 없어요. 비공개로 바뀌었거나 확정 버전이 없을 수 있어요.</p>
        : (
          <>
            <h4>{world.name}</h4>
            <p className="small muted">{world.authorNickname} · 확정 버전 {world.revisionNo}</p>
            {!cards.length ? <p className="muted">공개된 설정이 없어요.</p> : (
              <>
                <label className="world-import-check"><input ref={all} type="checkbox" checked={picked.length === cards.length} onChange={(e) => setChecked(new Set(e.target.checked ? cards.map((card) => card.id) : []))} />전체 선택 <small>{picked.length} / {cards.length}</small></label>
                <ul className="world-import-cards">
                  {cards.map((card) => {
                    const type = cardTypes.find((known) => known.id === card.cardType)?.label ?? '기타'
                    return (
                      <li key={card.id}>
                        <label className="world-import-check">
                          <input type="checkbox" aria-label={`${type} ${card.title}`} aria-describedby={`${summaryId}-${card.id}`} checked={checked.has(card.id)} onChange={(e) => toggle(card.id, e.target.checked)} />
                          <span><KindChip kind={CARD_KIND[card.cardType]} label={type} /> <strong>{card.title}</strong><small id={`${summaryId}-${card.id}`}>{plainCardText(card.text)}</small></span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                <label className="world-import-check"><input type="checkbox" checked={withRelations && relations} disabled={!relations} onChange={(e) => setWithRelations(e.target.checked)} />같이 가져온 카드 사이 관계 포함</label>
                <p className="small muted">{relations ? '관계는 이름만 옮겨 와요. 방향과 종류는 가져온 뒤 인물 관계도에서 고칠 수 있어요.' : '관계를 불러오지 못해 지금은 관계를 함께 가져올 수 없어요.'}</p>
                {problem && <p role="alert" className="world-error">{problem}</p>}
                <div className="world-sheet-actions">
                  <p className="small muted">가져온 설정은 비공개로 초안에 더해져요. 세계관을 저장해야 반영돼요.</p>
                  <button type="button" className="btn pri" disabled={!picked.length || vm.busy} onClick={run}>{picked.length ? `설정 ${picked.length}개 가져오기` : '가져오기'}</button>
                </div>
              </>
            )}
          </>
        )}
    </section>
  )
}

/**
 * `다른 세계관에서 가져오기` 시트(DEC-46 설정 가져오기): 공개 세계관을 고르고 → 그 세계관의 공개 설정을 체크해 → 내 세계관 초안에 새 카드로 복사한다. 늘 세계관 고르기부터 시작한다.
 * 서버에는 가져오기 API가 없고 공개 조회 응답을 복사할 뿐이라, 가져온 설정은 기존 세계관 저장으로 반영된다.
 */
export function WorldImportSheet({ vm, onClose, onImported }: { vm: VM; onClose: () => void; /** 가져온 직후(닫기 전): 새 카드가 목록에 보이게 필터를 되돌린다 */ onImported: () => void }) {
  const targetId = vm.editing!.id
  const [sourceId, setSourceId] = useState('')
  return (
    <Sheet sid="W01" label="다른 세계관에서 가져오기" panelClass="sheet world-sheet" onClose={onClose}>
      <div className="world-sheet-head"><h3>다른 세계관에서 가져오기</h3><button type="button" className="btn sm" onClick={onClose}>닫기</button></div>
      <p className="small muted">공개 세계관의 공개 설정을 골라 내 세계관에 복사해요. 출처가 함께 기록되고, 가져온 뒤에는 원본이 바뀌어도 따라가지 않아요.</p>
      {sourceId
        ? <ImportCards key={sourceId} vm={vm} sourceId={sourceId} back={() => setSourceId('')} done={() => { onImported(); onClose() }} />
        : <ImportWorlds targetId={targetId} pick={setSourceId} />}
    </Sheet>
  )
}
