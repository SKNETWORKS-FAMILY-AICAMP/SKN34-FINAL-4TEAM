import { useId, type KeyboardEvent } from 'react'

import { BEATS_MAX, PREMISE_MAX, PROPOSAL_BODY_MAX, PROPOSAL_KINDS, PROPOSAL_TITLE_MAX, type SerialBoardView, type SerialProposal } from '../../../../domain/entities/aiSerial'
import type { Work } from '../../../../domain/entities/work'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { kstDateTime } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { useSerialBoardViewModel, type useSerialBoardRead } from '../viewmodel/useSerialBoardViewModel'
import './serial.css'

const SUBS = [['vote', '투표'], ['board', '제안 게시판']] as const

type Vm = ReturnType<typeof useSerialBoardViewModel>

/** 투표 하위 탭: 대상 회차와 선택지 4개(번호·글·득표)를 보이고 하나를 고른다(회원당 1표, 옮기기·취소). 비로그인은 읽기만 하고 로그인 안내를 받는다. */
function Vote({ vm, view }: { vm: Vm; view: SerialBoardView }) {
  if (!view.board) {
    return (
      <>
        <p className="ws-q">다음 회차를 쓰고 있어요</p>
        {view.summary && <div className="ws-sum"><b>지난 회차 종합</b><p>{view.summary}</p></div>}
      </>
    )
  }
  return (
    <>
      <p className="ws-q">다음 회차는 어떻게 흘러갈까요?</p>
      <p className="ws-help muted small">{view.board.episodeNumber}화에 이어질 전개를 독자가 골라요. 마감 때 가장 많은 표를 받은 선택지를 중심으로, 추천을 많이 받은 제안 글 3개를 참고해 AI가 다음 회차를 써요. 표는 하나만 줄 수 있고 다른 선택지로 옮기거나 취소할 수 있어요.</p>
      {view.choices.length === 0
        ? <p className="muted">선택지를 준비하고 있어요</p>
        : (
          <ol className="ws-list" aria-label="다음 전개 선택지" data-tour="work-serial-vote">
            {view.choices.map((c) => {
              const mine = c.id === view.myChoiceId
              const body = (
                <>
                  <span className="ws-no">{c.position}</span>
                  <span className="ws-ctext">{c.text}</span>
                  <span className="ws-votes">{c.votes}표</span>
                  {mine && <span className="ws-badge mine">내 선택</span>}
                </>
              )
              return (
                <li key={c.id} className="ws-choice" data-mine={mine ? '' : undefined}>
                  {vm.loggedIn
                    ? <label><input type="radio" name="ws-choice" aria-label={c.position + '번 ' + c.text} checked={mine} disabled={vm.busy} onChange={() => void vm.vote(c.id)} />{body}</label>
                    : <div className="ws-choice-read">{body}</div>}
                </li>
              )
            })}
          </ol>
        )}
      {vm.loggedIn
        ? view.myChoiceId && <div className="ws-act"><button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.cancelVote()}>투표 취소</button></div>
        : <p className="muted small">투표하려면 <Go to="/login" onClick={vm.requireLogin}>로그인</Go>해 주세요.</p>}
    </>
  )
}

/** 제안 글 쓰기 폼: 일반 또는 시뮬레이션(전제·비트). 입력·규칙 검사·보내기는 뷰모델(form)이 맡고, 규칙을 넘은 이유는 입력 칸과 보내기 버튼이 aria-describedby로 가리킨다. */
function ProposalForm({ form, busy }: { form: Vm['form']; busy: boolean }) {
  const hint = useId()
  const why = form.problem ? hint : undefined
  const sendingSimulation = busy && form.kind === 'simulation'
  return (
    <form className="ws-form" aria-label="제안 글 쓰기" onSubmit={(e) => { e.preventDefault(); void form.send() }}>
      <fieldset disabled={busy}>
        <legend>제안 유형</legend>
        {PROPOSAL_KINDS.map(([k, name]) => <label key={k}><input type="radio" name="ws-kind" checked={form.kind === k} onChange={() => form.setKind(k)} /> {name}</label>)}
      </fieldset>
      <input className="inp" aria-label="제안 제목" aria-describedby={why} placeholder={'제목 (' + PROPOSAL_TITLE_MAX + '자까지)'} maxLength={PROPOSAL_TITLE_MAX} value={form.title} disabled={busy} onChange={(e) => form.setTitle(e.target.value)} />
      <textarea className="ta" aria-label="제안 내용" aria-describedby={why} placeholder={'다음 회차에서 보고 싶은 전개를 적어 주세요 (' + PROPOSAL_BODY_MAX.toLocaleString('ko-KR') + '자까지)'} rows={4} maxLength={PROPOSAL_BODY_MAX} value={form.body} disabled={busy} onChange={(e) => form.setBody(e.target.value)} />
      {form.kind === 'simulation' && (
        <>
          <p className="ws-hint">AI가 이 전제와 비트로 짧은 장면 미리보기를 만들어 글에 붙여요. 미리보기를 만들 때 크레딧이 차감됩니다. 만들지 못하면 글도 저장되지 않고 차감도 없어요.</p>
          <textarea className="ta" aria-label="시뮬레이션 전제" aria-describedby={why} placeholder="전제: 예) 주인공이 그 편지를 읽었다면" rows={3} maxLength={PREMISE_MAX} value={form.premise} disabled={busy} onChange={(e) => form.setPremise(e.target.value)} />
          <textarea className="ta" aria-label="장면 비트" aria-describedby={why} placeholder={'한 줄에 비트 하나, 최대 ' + BEATS_MAX + '개 (선택)'} rows={4} value={form.beats} disabled={busy} onChange={(e) => form.setBeats(e.target.value)} />
        </>
      )}
      {form.problem && <p id={hint} className="ws-hint err">{form.problem}</p>}
      {sendingSimulation && <p role="status" className="ws-hint">장면 미리보기를 만들고 있어요. 잠시만 기다려 주세요…</p>}
      <div className="ws-form-foot">
        <button type="button" className="btn sm" disabled={busy} onClick={form.cancel}>취소</button>
        <button type="submit" className="btn sm pri" disabled={!form.canSubmit} aria-describedby={why}>제안 올리기</button>
      </div>
    </form>
  )
}

/** 제안 게시판 하위 탭: 목록(제목·작성자·추천 수·작성 시각, 최신순·추천순)과 글쓰기. 글을 누르면 본문·시뮬레이션 미리보기·추천 버튼이 펼쳐지고 소유자에게는 숨기기가 있다. */
function Proposals({ vm, view }: { vm: Vm; view: SerialBoardView }) {
  const noBoard = useId()
  const row = (p: SerialProposal) => {
    const open = vm.openId === p.id
    const detail = 'ws-p-' + p.id
    return (
      <li key={p.id} className="ws-op" data-mine={p.mine ? '' : undefined}>
        <div className="ws-head">
          <button type="button" className="ws-title" aria-expanded={open} aria-controls={detail} onClick={() => vm.toggleOpen(p.id)}>{p.title}</button>
          {p.kind === 'simulation' && <span className="ws-badge">시뮬레이션</span>}
          {p.mine && <span className="ws-badge mine">내 글</span>}
          <span className="ws-meta">{p.authorName} · 추천 {p.likes} · <time dateTime={p.createdAt}>{kstDateTime(p.createdAt)}</time></span>
        </div>
        {open && (
          <div id={detail} className="ws-detail">
            <p className="ws-body">{p.body}</p>
            {p.kind === 'simulation' && p.simulation && (
              <>
                <p className="ws-body">{p.simulation.premise}</p>
                {p.simulation.beats.length > 0 && <ul className="ws-beats">{p.simulation.beats.map((beat, i) => <li key={i}>{beat}</li>)}</ul>}
                {p.simulation.scene
                  ? <blockquote className="ws-scene"><b>AI 장면 미리보기</b><p>{p.simulation.scene}</p></blockquote>
                  : <p className="muted small">장면 미리보기가 아직 없어요.</p>}
              </>
            )}
            <div className="ws-act">
              {vm.loggedIn && <button type="button" className="btn sm" aria-pressed={p.likedByMe} disabled={vm.busy} onClick={() => void vm.toggleLike(p)}>{p.likedByMe ? '추천 취소' : '추천'}</button>}
              {vm.canHide && <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.hide(p.id)}>숨기기</button>}
            </div>
          </div>
        )}
      </li>
    )
  }
  return (
    <>
      <div className="ws-tools">
        <div className="sortt" role="group" aria-label="제안 정렬">
          <button type="button" className={vm.sort === 'new' ? 'on' : ''} aria-pressed={vm.sort === 'new'} onClick={() => vm.setSort('new')}>최신순</button>
          <button type="button" className={vm.sort === 'likes' ? 'on' : ''} aria-pressed={vm.sort === 'likes'} onClick={() => vm.setSort('likes')}>추천순</button>
        </div>
        {vm.loggedIn && <button type="button" className="btn sm pri" data-tour="work-serial-write" aria-expanded={vm.writing} disabled={!view.board} aria-describedby={view.board ? undefined : noBoard} onClick={() => vm.setWriting(!vm.writing)}>글쓰기</button>}
      </div>
      {!view.board && <p id={noBoard} className="muted small">지금은 열린 게시판이 없어요. 게시판이 열리면 제안을 쓰고 추천할 수 있어요.</p>}
      {!vm.loggedIn && <p className="muted small">제안을 쓰고 추천하려면 <Go to="/login" onClick={vm.requireLogin}>로그인</Go>해 주세요.</p>}
      {vm.loggedIn && vm.writing && view.board && <ProposalForm form={vm.form} busy={vm.busy} />}
      {/* ponytail: 쪽 나눔 없이 서버가 준 제안 글(최신순 최대 200개)을 모두 그린다(게시판당 시연 규모). 많아지면 paginate·Pager를 쓴다. */}
      {vm.proposals.length > 0 ? <ol className="ws-list" aria-label="제안 목록">{vm.proposals.map(row)}</ol> : <p className="muted">아직 제안이 없어요. 첫 제안을 남겨 보세요.</p>}
    </>
  )
}

/**
 * 소설 상세 '다음 회차' 탭의 내용(UC-18, [계약](../../../../../../docs/design/ai-serial-contract.md)): 하위 탭 '투표 | 제안 게시판'.
 * 탭은 AI 자율 집필이 켜져 있을 때만 소설 상세가 보이므로 이 컴포넌트는 읽은 게시판(read)이 있을 때 그려진다. 첫 조회의 읽는 중·실패는 소설 상세 몫이고, 쓴 뒤 최신 게시판을 다시 읽지 못하면 이전 게시판을 둔 채 배너로 다시 불러오기를 보인다.
 * 비로그인은 읽기만 하고 투표·글쓰기·추천 자리에 로그인 안내를 받는다(권한은 서버가 다시 확인한다). 작품이 바뀌면 호출 측이 key로 새로 만든다.
 */
export function SerialBoard({ work, read, useCase }: { work: Work; read: ReturnType<typeof useSerialBoardRead>; useCase?: SerialUseCase }) {
  const vm = useSerialBoardViewModel(work, read, useCase)
  const { view } = vm
  if (!view) return null // 소설 상세가 첫 조회를 마친 뒤에만 이 탭을 그린다(첫 조회 실패는 소설 상세가 탭 줄 위에서 알린다).
  /** 하위 탭의 방향키·Home·End로 탭을 옮긴다(소설 상세 탭과 같은 키 동작). 선택한 탭만 Tab 순서에 들어간다. */
  const moveSub = (e: KeyboardEvent) => {
    const i = SUBS.findIndex(([k]) => k === vm.sub)
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? SUBS.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = SUBS[(to + SUBS.length) % SUBS.length][0]
    vm.setSub(next)
    document.getElementById('stab-' + next)?.focus()
  }
  return (
    <div className="wserial">
      <div className="wtabs ws-sub" role="tablist" aria-label="다음 회차 하위 탭" data-tour="work-serial-tabs" onKeyDown={moveSub}>
        {SUBS.map(([k, label]) => <button key={k} type="button" role="tab" id={'stab-' + k} aria-selected={vm.sub === k} aria-controls="spanel-serial" tabIndex={vm.sub === k ? 0 : -1} className={vm.sub === k ? 'on' : ''} onClick={() => vm.setSub(k)}>{label}</button>)}
      </div>
      <div id="spanel-serial" role="tabpanel" aria-labelledby={'stab-' + vm.sub}>
        {vm.notice?.ok && <p role="status" className="ws-note">{vm.notice.text}</p>}
        {vm.notice && !vm.notice.ok && <p role="alert" className="ws-note err">{vm.notice.text}</p>}
        {vm.isError && (
          <div role="alert" className="ws-retry">
            <span className="muted">최신 게시판을 불러오지 못했어요.</span>
            <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
          </div>
        )}
        {vm.sub === 'vote' ? <Vote vm={vm} view={view} /> : <Proposals vm={vm} view={view} />}
      </div>
    </div>
  )
}
