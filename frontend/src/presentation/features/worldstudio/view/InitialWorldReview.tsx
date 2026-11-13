import { useEffect, useRef, useState, type FormEvent } from 'react'

import type { Candidate, ReviewAction } from '../../../../domain/entities/initialWorld'
import { reviewGroups, type ReviewFilter, type ReviewItem } from '../viewmodel/reviewQueue'
import { useInitialWorldReview } from '../viewmodel/useInitialWorldReview'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { WorldCandidates } from './WorldCandidates'

const types: Record<Candidate['type'], string> = { fact: '사실', relation: '관계', rule: '규칙', event: '발생한 사건', conjecture: '추측', goal: '목표', plan: '계획' }
const execution = { running: '분석 중', completed: '분석 완료', failed: '분석 실패', unknown: '분석 결과 미확인' }
const filters: [ReviewFilter, string][] = [['pending', '검토 대기'], ['approved', '승인'], ['rejected', '거절']]
const empty: Record<ReviewFilter, string> = { pending: '검토할 후보를 모두 처리했어요.', approved: '승인한 후보가 없어요.', rejected: '거절한 후보가 없어요.' }
type VM = ReturnType<typeof useWorldStudioViewModel>
export type Review = ReturnType<typeof useInitialWorldReview>

/**
 * AI 후보 검토 화면(설정집 화면의 시트). 위에는 상태 필터 칩(검토 대기·승인·거절, 기본은 검토 대기)과 `AI 분석 다시 요청`, 아래는 후보를 카드로 한 장씩 넘겨 보는 목록이다:
 * 분류 칩·이름·내용(3줄)·누가 쓴 내용인지, 근거는 `근거 보기`, 하단에 `승인`·`거절`·`보류`(보조 스타일)·`내용 수정`. 승인·거절·보류하면 다음 후보로 초점이 간다.
 * 승인한 후보가 있으면 목록 위에 고정된 `승인한 후보 N개 초안에 반영` 바가 보인다. 분석이 없으면 설명 한 줄과 `AI 분석 요청`(저장한 초안이 없으면 잠기고 먼저 저장하라고 알린다)만 보인다.
 * 기능·API·승인 규칙은 그대로이고(보류한 후보는 아직 끝나지 않은 검토라 '검토 대기'에 들어 '보류' 표시가 붙는다), 요청·검토·반영의 로딩·실패·복구 상태는 가짜 성공 없이 그대로 보인다.
 */
export function ReviewBody({ studio, vm }: { studio: VM; vm: Review }) {
  const [filter, setFilter] = useState<ReviewFilter>('pending')
  const [editing, setEditing] = useState('') // 내용 수정 폼이 열린 후보 id
  const [focus, setFocus] = useState('') // 다음에 초점을 받을 후보 id(목록이 비면 'done')
  const heads = useRef<Record<string, HTMLElement | null>>({})
  const done = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (!focus) return
    ;(focus === 'done' ? done.current : heads.current[focus])?.focus({ preventScroll: true })
    setFocus('')
  }, [focus])
  const analysis = vm.analysis
  const groups = reviewGroups(analysis)
  const unsaved = studio.dirty || studio.relationDirty
  const blocked = vm.busy || vm.pending || analysis?.freshness === 'stale' || analysis?.executionStatus !== 'completed'
  const saved = !!studio.saved && studio.saved.version > 0
  const canAnalyze = !vm.busy && !vm.pending && !unsaved && saved
  const name = (id: string | null) => studio.saved?.settings.find((s) => s.item.id === id)?.item.title ?? '연결된 설정'
  const applied = (id: string) => !!studio.saved?.settings.some((s) => { const p = s.serverMetadata?.preprocessing; return p && typeof p === 'object' && 'candidateId' in p && p.candidateId === id })
  const approved = groups.approved.filter((item) => !applied(item.current.id)).map((item) => item.current.id)
  const shown = groups[filter]
  if (vm.demo) return <section className="world-analysis"><h3>AI 후보 검토</h3><p>목업 모드는 실제 AI 분석·검토 저장·초안 반영을 지원하지 않아요.</p><button className="btn" disabled>AI 분석 요청 · 실제 서버 모드에서 사용</button><WorldCandidates analysis={studio.saved?.analysis ?? null} /></section>

  /**
   * 결정을 저장한다. 끝났을 때 초점이 그대로이거나 body로 빠졌으면 다음 후보(없으면 앞 후보)로 옮긴다(대기 중 사용자가 옮긴 초점은 뺏지 않는다).
   * 수정은 대기로 남아 같은 카드에 두고, 후보가 하나뿐일 때 보류(검토 대기에 남는다)는 그 카드에, 승인·거절은 목록이 비는 안내에 둔다.
   */
  const decide = async (item: ReviewItem, action: ReviewAction, edited: Candidate | null) => {
    const from = document.activeElement
    const id = item.current.id
    const at = shown.findIndex((i) => i.current.id === id)
    const rest = shown.filter((i) => i.current.id !== id)
    const stays = filter === 'pending' && (action === 'edit' || action === 'hold')
    const next = action === 'edit' && filter === 'pending' ? id : (rest[at] ?? rest[at - 1])?.current.id ?? (stays ? id : 'done')
    await vm.decide(item.original, action, edited, '')
    if (document.activeElement === from || document.activeElement === document.body) setFocus(next)
  }
  const card = (item: ReviewItem) => {
    const { original, current } = item
    const id = current.id
    const content = current.content
    const reflected = applied(id)
    return (
      <article className="initial-card" key={`${analysis!.analysisId}:${id}`}>
        <div className="initial-card-head">
          <span className="chip">{types[content.type]}</span>
          {current.state === 'held' && <span className="chip wait">보류</span>}
          {reflected && <span className="chip ok">초안 반영 완료</span>}
        </div>
        <h4 tabIndex={-1} ref={(el) => { heads.current[id] = el }}>{content.title}</h4>
        <p className="initial-source-label">{content.provenance === 'author_revision' ? '작가가 수정한 내용' : 'AI가 제안한 내용'}</p>
        {content.polarity === 'denied' && <p className="initial-source-label">부정: 아래 내용이 사실이 아니라는 제안이에요</p>}
        <p className="initial-copy initial-clamp">{content.text}</p>
        {content.condition.trim() && <p className="small">적용 조건: {content.condition}</p>}
        {content.timeText.trim() && <p className="small">이야기 속 시점: {content.timeText}</p>}
        {content.subjectId && <p className="small">관련 설정: {name(content.subjectId)}</p>}
        {content.relation && <p className="small">{name(content.relation.sourceCardId)} {content.relation.direction === 'symmetric' ? '↔' : '→'} {name(content.relation.targetCardId)} · {content.relation.category === 'emotional' ? '감정' : '구조 관계'} · {content.relation.label}{content.relation.polarity === 'denied' ? ' (부정)' : ''}</p>}
        <details>
          <summary>근거 보기</summary>
          <p className="initial-source-label">원래 AI 제안</p>
          <p className="initial-copy">{original.text}</p>
          {original.evidence.map((e, i) => <blockquote key={i}><span className="small">{e.sourceId.endsWith(':description') ? '세계관 설명' : e.sourceId.endsWith(':title') ? '설정 이름' : '설정 내용'}에서 인용</span><p className="initial-copy">{e.quote}</p></blockquote>)}
          {content.provenance === 'author_revision' && <><p className="initial-source-label">작가 수정본 전체</p><p className="initial-copy">{content.text}</p><p className="small">위 근거는 원래 AI 제안의 근거이며, 작가 수정본의 근거가 아니에요.</p></>}
        </details>
        <details>
          <summary>검토 이력</summary>
          {analysis!.decisions.filter((d) => d.candidateId === id).map((d) => <p className="small" key={d.sequence}>{d.state === 'approved' ? '작가 승인 · 초안 반영 전' : d.state === 'rejected' ? '거절' : d.state === 'held' ? '보류' : '검토 대기'} · {d.content.text}</p>)}
        </details>
        <div className="initial-card-actions">
          {current.state !== 'approved' && <button type="button" className="btn pri sm" disabled={blocked} onClick={() => void decide(item, 'approve', null)}>승인</button>}
          {current.state !== 'rejected' && <button type="button" className="btn sm" disabled={blocked} onClick={() => void decide(item, 'reject', null)}>거절</button>}
          {current.state !== 'held' && <button type="button" className="btn sm initial-hold" disabled={blocked} onClick={() => void decide(item, 'hold', null)}>보류</button>}
          <button type="button" className="btn sm" disabled={blocked} aria-expanded={editing === id} aria-controls={`edit-${id}`} onClick={() => setEditing(editing === id ? '' : id)}>내용 수정</button>
        </div>
        {editing === id && <CandidateEdit id={`edit-${id}`} key={current.sequence} candidate={content} disabled={blocked} save={async (edited) => { await decide(item, 'edit', edited); setEditing('') }} />}
      </article>
    )
  }
  return (
    <section className="world-analysis initial-review" aria-label="AI 후보 검토" aria-busy={vm.busy}>
      <h3>AI 후보 검토</h3>
      <p>저장한 초안을 분석해 AI가 제안한 설정 후보예요. 승인한 후보만 ‘초안에 반영’해야 설정에 추가돼요.</p>
      {unsaved && <p role="status">작성 중인 입력이 있어요. 먼저 저장해 주세요.</p>}
      {vm.error && <p role="alert" className="world-error">{vm.error}</p>}
      {vm.message && <p role="status">{vm.message}</p>}
      {vm.pending && <div className="initial-recovery"><p>결과를 확인하지 못한 요청이 있어요. 새 요청을 만들지 않고 기존 요청을 그대로 확인해요. 새로고침·재로그인 후에도 이 브라우저에서 이어서 확인할 수 있어요.</p><button className="btn" disabled={vm.busy} onClick={vm.recover}>같은 요청으로 확인·복구</button></div>}
      {!analysis && !vm.busy && (
        <div className="initial-empty">
          <p>아직 분석한 후보가 없어요. 저장한 세계관을 AI가 읽고 설정 후보를 제안해요.</p>
          <button type="button" className="btn pri" disabled={!canAnalyze} aria-describedby={saved ? undefined : 'initial-save-first'} onClick={vm.analyze}>AI 분석 요청</button>
          {!saved && <p id="initial-save-first" className="small muted">먼저 세계관을 저장하세요.</p>}
        </div>
      )}
      {analysis && (
        <>
          <div className="initial-top">
            <div className="initial-filters" role="group" aria-label="후보 상태">
              {filters.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label} {groups[key].length}</button>)}
            </div>
            <div className="initial-top-actions">
              <button type="button" className="btn sm" disabled={vm.busy} onClick={vm.refresh}>결과 새로 확인</button>
              <button type="button" className="btn pri sm" disabled={!canAnalyze} onClick={vm.analyze}>AI 분석 다시 요청</button>
            </div>
          </div>
          {vm.analyses.length > 1 && <label className="field">분석 기록<select className="inp" value={analysis.analysisId} disabled={vm.busy || vm.pending} onChange={(e) => vm.select(e.target.value)}>{vm.analyses.map((a, i) => <option key={a.analysisId} value={a.analysisId}>분석 {vm.analyses.length - i} · {execution[a.executionStatus]}{a.freshness === 'stale' ? ' · 원본 변경됨' : ''}</option>)}</select></label>}
          <p role="status">{execution[analysis.executionStatus]}{analysis.freshness === 'stale' ? ' · 원본이 변경되어 새 검토·반영은 할 수 없어요. 저장 후 재분석해 주세요.' : ''}</p>
          {analysis.output?.diagnostics.map((d, i) => <p key={i} className="small">분석 안내: {d}</p>)}
          {!!approved.length && (
            <div className="initial-apply-bar">
              <p className="small">반영하면 원본이 바뀌므로 남은 후보는 재분석이 필요해요.</p>
              <button type="button" className="btn pri" disabled={blocked || unsaved} onClick={() => void vm.apply(approved)}>승인한 후보 {approved.length}개 초안에 반영</button>
            </div>
          )}
          <div className="initial-cards">
            {shown.map(card)}
            {!shown.length && <p ref={done} tabIndex={-1} className="muted initial-done">{empty[filter]}</p>}
          </div>
        </>
      )}
      {vm.receipt && <p role="status">{vm.receipt.status === 'applied' ? `서버 반영 완료 기록: 설정 ${vm.receipt.createdCardIds.length}개 · 관계 ${vm.receipt.createdRelationshipIds.length}개` : vm.receipt.status === 'failed' ? '서버 반영 실패 · 최신 상태를 확인해 주세요.' : '서버 반영 완료 미확인 · 같은 요청으로 확인해 주세요.'}</p>}
    </section>
  )
}

/** 세계관을 읽지 못했을 때(오류 화면) 같은 요청 복구를 위해 시트 없이 쓰는 후보 검토. 정상 화면은 `WorldAiReview`의 시트가 같은 `ReviewBody`를 쓴다. */
export function InitialWorldReview({ studio }: { studio: VM }) {
  const vm = useInitialWorldReview(studio.reviewWorldId, true, studio.dirty || studio.relationDirty, studio.saved?.version, studio.reload, studio.setReviewBusy)
  return <ReviewBody studio={studio} vm={vm} />
}

function CandidateEdit({ id, candidate, disabled, save }: { id: string; candidate: Candidate; disabled: boolean; save: (c: Candidate) => Promise<void> }) {
  const [title, setTitle] = useState(candidate.title)
  const [text, setText] = useState(candidate.text)
  const [condition, setCondition] = useState(candidate.condition)
  const [timeText, setTimeText] = useState(candidate.timeText)
  const submit = (e: FormEvent) => { e.preventDefault(); void save({ ...candidate, title, text, condition, timeText, provenance: 'author_revision', evidence: [] }) }
  return (
    <form id={id} className="initial-edit" aria-label="후보 내용 수정" onSubmit={submit}>
      <fieldset disabled={disabled}>
        <label className="field">후보 이름<input className="inp" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">후보 내용<textarea className="ta" required maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <label className="field">적용 조건<input className="inp" value={condition} onChange={(e) => setCondition(e.target.value)} /></label>
        <label className="field">이야기 속 시점<input className="inp" value={timeText} onChange={(e) => setTimeText(e.target.value)} /></label>
        <p className="small">수정 저장 후 검토 대기가 돼요. 별도로 다시 승인해야 반영할 수 있어요.</p>
        <button className="btn" type="submit">수정본 저장 · 재승인 필요</button>
      </fieldset>
    </form>
  )
}
