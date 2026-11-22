import { useState } from 'react'

import { BEATS_MAX, OPINION_BODY_MAX, OPINION_KINDS, PREMISE_MAX, opinionInputError, type OpinionInput, type OpinionKind, type SerialOpinion } from '../../../../domain/entities/aiSerial'
import type { Work } from '../../../../domain/entities/work'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { kstDateTime } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { useSerialBoardViewModel } from '../viewmodel/useSerialBoardViewModel'
import './serial.css'

const kindName = (kind: OpinionKind) => OPINION_KINDS.find(([k]) => k === kind)?.[1] ?? kind

/** 의견 쓰기 폼: 일반 의견 또는 시뮬레이션(전제·비트). 보내기에 성공하면 비우고, 실패하면 입력을 그대로 둔다. */
function OpinionForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: OpinionInput) => Promise<boolean> }) {
  const [kind, setKind] = useState<OpinionKind>('general')
  const [body, setBody] = useState('')
  const [premise, setPremise] = useState('')
  const [beats, setBeats] = useState('')
  const input: OpinionInput = kind === 'general' ? { kind, body } : { kind, premise, beats: beats.split('\n') }
  const filled = kind === 'general' ? !!body.trim() : !!premise.trim()
  // 쓴 글이 규칙을 넘었을 때만 이유를 보인다(빈 입력은 보내기 버튼이 잠겨 있을 뿐이다).
  const problem = filled ? opinionInputError(input) : null
  const sendingSimulation = busy && kind === 'simulation'
  return (
    <form className="ws-form" aria-label="의견 쓰기" onSubmit={(e) => {
      e.preventDefault()
      void onSubmit(input).then((ok) => { if (ok) { setBody(''); setPremise(''); setBeats('') } })
    }}>
      <fieldset disabled={busy}>
        <legend>의견 유형</legend>
        {OPINION_KINDS.map(([k, name]) => <label key={k}><input type="radio" name="ws-kind" checked={kind === k} onChange={() => setKind(k)} /> {name}</label>)}
      </fieldset>
      {kind === 'general'
        ? <textarea className="ta" aria-label="다음 전개 의견" placeholder={'다음 회차에서 보고 싶은 전개를 적어 주세요 (' + OPINION_BODY_MAX.toLocaleString('ko-KR') + '자까지)'} rows={4} maxLength={OPINION_BODY_MAX} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
        : (
          <>
            <p className="ws-hint">AI가 이 전제와 비트로 짧은 장면 미리보기를 만들어 의견에 붙여요. 미리보기를 만들 때 크레딧이 차감됩니다. 만들지 못하면 의견도 저장되지 않고 차감도 없어요.</p>
            <textarea className="ta" aria-label="시뮬레이션 전제" placeholder="전제: 예) 주인공이 그 편지를 읽었다면" rows={3} maxLength={PREMISE_MAX} value={premise} disabled={busy} onChange={(e) => setPremise(e.target.value)} />
            <textarea className="ta" aria-label="장면 비트" placeholder={'한 줄에 비트 하나, 최대 ' + BEATS_MAX + '개 (선택)'} rows={4} value={beats} disabled={busy} onChange={(e) => setBeats(e.target.value)} />
          </>
        )}
      {problem && <p className="ws-hint err">{problem}</p>}
      {sendingSimulation && <p role="status" className="ws-hint">장면 미리보기를 만들고 있어요. 잠시만 기다려 주세요…</p>}
      <div className="ws-form-foot">
        <button type="submit" className="btn sm pri" disabled={busy || !filled || !!problem}>의견 올리기</button>
      </div>
    </form>
  )
}

/**
 * 소설 상세의 '다음 회차 의견' 게시판(UC-18, [계약](../../../../../../docs/design/ai-serial-contract.md)). 열린 게시판이 없으면(또는 읽는 중이면) 섹션을 그리지 않는다.
 * 목록은 서버가 준 득표순 그대로이고, 로그인 회원은 의견 1개와 투표 1회(옮기기·취소)를, 작품 소유자는 의견 숨김을 할 수 있다(권한은 서버가 다시 확인한다).
 * 비로그인은 목록만 보고 로그인 안내를 받는다. 읽기 실패는 숨기지 않고 다시 불러오기를 보인다. 작품이 바뀌면 호출 측이 key로 새로 만든다.
 */
export function SerialBoard({ work, useCase }: { work: Work; useCase?: SerialUseCase }) {
  const vm = useSerialBoardViewModel(work, useCase)
  const { view } = vm
  if (!view && vm.isError) {
    return (
      <section className="tcard cms wserial" aria-labelledby="ws-title">
        <h2 id="ws-title">다음 회차 의견</h2>
        <div role="alert" className="ws-retry">
          <span className="muted">의견 게시판을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</span>
          <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
        </div>
      </section>
    )
  }
  if (!view?.board) return null
  const mine = view.myOpinionId
  const voted = view.myVoteOpinionId
  const row = (o: SerialOpinion) => (
    <li key={o.id} className="ws-op" data-mine={o.id === mine ? '' : undefined}>
      <div className="ws-head">
        <b>{o.authorName}</b>
        {o.id === mine && <span className="ws-badge mine">내 의견</span>}
        <span className="ws-badge">{kindName(o.kind)}</span>
        <time dateTime={o.createdAt}>{kstDateTime(o.createdAt)}</time>
      </div>
      {o.kind === 'simulation' && o.simulation
        ? (
          <>
            <p className="ws-body">{o.simulation.premise}</p>
            {o.simulation.beats.length > 0 && <ul className="ws-beats">{o.simulation.beats.map((beat, i) => <li key={i}>{beat}</li>)}</ul>}
            {o.simulation.scene
              ? <blockquote className="ws-scene"><b>AI 장면 미리보기</b><p>{o.simulation.scene}</p></blockquote>
              : <p className="muted small">장면 미리보기가 아직 없어요.</p>}
          </>
        )
        : <p className="ws-body">{o.body}</p>}
      <div className="ws-act">
        <span className="ws-votes">{o.votes}표</span>
        {vm.loggedIn && (o.id === voted
          ? <button type="button" className="btn sm" aria-pressed="true" disabled={vm.busy} onClick={() => void vm.cancelVote()}>투표 취소</button>
          : <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.vote(o.id)}>{voted ? '여기로 옮기기' : '투표'}</button>)}
        {vm.canHide && <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.hide(o.id)}>숨기기</button>}
      </div>
    </li>
  )
  return (
    <section className="tcard cms wserial" aria-labelledby="ws-title">
      <h2 id="ws-title">다음 회차 의견</h2>
      <p className="ws-q">다음 회차는 어떻게 흘러갈까요?</p>
      <p className="ws-help muted small">{view.board.episodeNumber}화에 담길 이야기를 독자가 정해요. 마감 때 득표 상위 3개 의견을 AI가 종합해 다음 회차를 써요. 의견은 하나, 투표는 한 번 할 수 있어요.</p>
      {view.summary && <div className="ws-sum"><b>지난 회차 의견 종합</b><p>{view.summary}</p></div>}
      {vm.notice?.ok && <p role="status" className="ws-note">{vm.notice.text}</p>}
      {vm.notice && !vm.notice.ok && <p role="alert" className="ws-note err">{vm.notice.text}</p>}
      {vm.isError && (
        <div role="alert" className="ws-retry">
          <span className="muted">최신 의견을 불러오지 못했어요.</span>
          <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
        </div>
      )}
      {/* ponytail: 쪽 나눔 없이 서버가 준 의견을 모두 그린다(게시판당 시연 규모). 많아지면 paginate·Pager를 쓴다. */}
      {view.opinions.length > 0 ? <ol className="ws-list" aria-label="의견 목록">{view.opinions.map(row)}</ol> : <p className="muted">아직 의견이 없어요. 첫 의견을 남겨 보세요.</p>}
      {vm.loggedIn
        ? (mine ? <p className="muted small">이 게시판에 이미 의견을 냈어요. 의견은 게시판마다 하나만 낼 수 있어요.</p> : <OpinionForm busy={vm.busy} onSubmit={vm.submit} />)
        : <p className="muted small">의견을 내고 투표하려면 <Go to="/login" onClick={vm.requireLogin}>로그인</Go>해 주세요.</p>}
    </section>
  )
}
