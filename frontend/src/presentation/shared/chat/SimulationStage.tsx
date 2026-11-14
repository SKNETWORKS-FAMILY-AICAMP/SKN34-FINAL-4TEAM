import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'

import {
  beatLabel, checkKindLabel, checkSummary, evidenceLabel, monologueOwner, SIM_CHARACTERS_MAX, SIM_PREMISE_MAX,
  type CharacterSimulation, type SimulationStart, type SimulationTurn,
} from '../../../domain/entities/characterSimulation'
import { ManuscriptBody } from '../media/MediaPanel'
import { useSimulationSetupViewModel } from './useSimulationSetupViewModel'
import type { StageViewModel } from './useSimulationStageViewModel'
import './chat.css'
import './stage.css'

/** OpenAI 전송·비용 동의. 채팅 입력창 위 동의와 같은 값이다(채팅을 접어 둬도 무대에서 체크할 수 있다). */
function Consent({ stage }: { stage: StageViewModel }) {
  if (!stage.available) return null
  return <label className="chat-consent">
    <input type="checkbox" checked={stage.consent} onChange={(e) => stage.setConsent(e.target.checked)} />
    <span>질문과 발행 회차 일부를 OpenAI로 보내고 API 비용이 드는 데 동의해요.</span>
  </label>
}

/**
 * 시작 양식(버튼 진입): 모드를 고르고 IF는 전제, 흐름은 이 회차의 장면 계획(없으면 직접 입력)을 비트로 정하며 참여 인물을 1~6명 고른다.
 * 값은 서버 한도를 도메인(simulationIssue)이 검사한다. 입력하는 동안은 덜 채운 것을 꾸짖지 않고 한도를 넘긴 것만 알린다.
 */
function StartFields({ stage, data, planEpisode, plotLink }: {
  stage: StageViewModel; data: NonNullable<ReturnType<typeof useSimulationSetupViewModel>['ready']>; planEpisode: number | null; plotLink: ReactNode
}) {
  const id = useId()
  const [mode, setMode] = useState<'if' | 'flow'>('if')
  const [premise, setPremise] = useState('')
  const [lines, setLines] = useState('')
  // 모드마다 고른 인물을 따로 둔다: 흐름은 장면 계획의 인물을 미리 고르고, IF는 작가가 고른다.
  const [picked, setPicked] = useState<Record<'if' | 'flow', string[]>>({ if: [], flow: data.characterIds })
  const ids = data.characters.filter((character) => picked[mode].includes(character.id)).map((character) => character.id)
  const fromPlan = mode === 'flow' && data.beats.length > 0
  const start: SimulationStart = mode === 'if'
    ? { mode: 'if', premise, characterIds: ids }
    : { mode: 'flow', beats: fromPlan ? data.beats : lines.split('\n'), characterIds: ids }
  const problem = stage.issue(start)
  const toggle = (characterId: string) => setPicked((now) => ({
    ...now, [mode]: now[mode].includes(characterId) ? now[mode].filter((other) => other !== characterId) : [...now[mode], characterId],
  }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (problem || stage.blocked || stage.pending) return
    void stage.start(start, fromPlan ? 'plan' : 'manual', Object.fromEntries(data.characters.filter((character) => ids.includes(character.id)).map((character) => [character.id, character.name])))
  }
  return <form className="stage-form" onSubmit={submit}>
    <fieldset className="stage-fieldset">
      <legend>시뮬레이션 방식</legend>
      <label className="stage-radio"><input type="radio" name={`${id}-mode`} checked={mode === 'if'} onChange={() => setMode('if')} />IF · 만약 ~했다면?</label>
      <label className="stage-radio"><input type="radio" name={`${id}-mode`} checked={mode === 'flow'} onChange={() => setMode('flow')} />흐름 · 장면 계획을 따라</label>
    </fieldset>
    {mode === 'if'
      ? <label className="chat-field">전제
        <input value={premise} maxLength={SIM_PREMISE_MAX} placeholder="예: 만약 카엘이 성문을 열었다면?" onChange={(e) => setPremise(e.target.value)} />
      </label>
      : data.beats.length
        ? <div className="stage-plan">
          <p>{planEpisode}화의 장면 계획 {data.beats.length}개를 순서대로 비트로 써요.</p>
          <ol aria-label="흐름 비트">{data.beats.map((beat, i) => <li key={i}>{beat}</li>)}</ol>
        </div>
        : <div className="stage-plan">
          <p>이 회차의 장면 계획이 없어요.</p>
          <p className="chat-note">{plotLink}에서 장면 계획을 만들거나, 아래에 비트를 직접 적어 주세요.</p>
          <label className="chat-field">비트 (한 줄에 하나, 최대 8줄)
            <textarea rows={4} value={lines} placeholder={'예:\n성문 앞에서 두 사람이 마주친다\n협상이 결렬된다'} onChange={(e) => setLines(e.target.value)} />
          </label>
        </div>}
    <fieldset className="stage-fieldset">
      <legend>참여 인물 (1~{SIM_CHARACTERS_MAX}명)</legend>
      {data.characters.length
        ? <ul className="stage-people">{data.characters.map((character) => <li key={character.id}>
          <label><input type="checkbox" checked={ids.includes(character.id)} disabled={!ids.includes(character.id) && ids.length >= SIM_CHARACTERS_MAX}
            onChange={() => toggle(character.id)} />{character.name}</label>
        </li>)}</ul>
        : <p className="chat-note">이 작품에 연결된 세계관에 인물 카드가 없어요. 세계관에 인물을 먼저 만들어 주세요.</p>}
      <p className="chat-note">{ids.length}명 선택</p>
    </fieldset>
    {problem && !problem.missing && <p className="stage-reason" role="status">{problem.text}</p>}
    <Consent stage={stage} />
    {stage.blocked && <p className="chat-note">{stage.blocked}</p>}
    <button type="submit" className="btn pri" disabled={!!problem || !!stage.blocked || stage.pending}>시뮬레이션 시작</button>
  </form>
}

function StartForm({ stage, workId, planEpisode, plotLink }: { stage: StageViewModel; workId: string; planEpisode: number | null; plotLink: ReactNode }) {
  const setup = useSimulationSetupViewModel(workId, planEpisode)
  return <div className="stage-start">
    <h3>어떤 장면을 시뮬레이션할까요?</h3>
    {stage.sceneError && <p className="stage-reason" role="alert">{stage.sceneError}</p>}
    {stage.answer && <p className="stage-answer" role="status">{stage.answer}</p>}
    {stage.starting && <p className="chat-note" role="status">시뮬레이션을 시작하고 있어요…</p>}
    {setup.loading
      ? <p className="chat-note" role="status">장면 계획과 인물을 불러오고 있어요…</p>
      : setup.failed
        ? <div className="chat-error" role="alert"><p>장면 계획과 인물을 불러오지 못했어요.</p><button type="button" className="btn sm" onClick={setup.retry}>다시 불러오기</button></div>
        : setup.ready && <StartFields stage={stage} data={setup.ready} planEpisode={planEpisode} plotLink={plotLink} />}
  </div>
}

/** 줄 하나의 검사·근거. 접어 두어 본문 읽기를 방해하지 않는다. */
function Checks({ turn }: { turn: SimulationTurn }) {
  const { passed, violated } = checkSummary(turn.checks)
  return <details className="stage-checks" aria-live="off">
    <summary>검사·근거 · 통과 {passed} · 위반 {violated}</summary>
    {!!turn.checks.length && <ul className="stage-list" aria-label="검사">{turn.checks.map((check, i) => <li key={i} data-passed={check.passed}>
      <b>{checkKindLabel[check.kind]}</b> <span className="stage-verdict">{check.passed ? '통과' : '위반'}</span>{check.detail && ` ${check.detail}`}
    </li>)}</ul>}
    <p className="chat-note">다시 생성 {turn.regenerated}회</p>
    {turn.evidence.length
      ? <ul className="stage-list stage-evidence" aria-label="근거">{turn.evidence.map((e, i) => <li key={i}>{evidenceLabel[e.source]} · {e.ref}</li>)}</ul>
      : <p className="chat-note">찾은 근거가 없어요.</p>}
  </details>
}

type Editing = { turn: number; text: string } | null

/**
 * 대본 한 줄: 나레이션은 이탤릭·회색 지문 블록, 독백은 시점 인물 이름 + 속마음 표시의 이탤릭 블록, 인물은 이름 + 말풍선.
 * 줄마다 수정·다시 말하기가 있다(작가가 고친 줄은 검사 결과가 없다).
 */
function Turn({ turn, stage, workId, episode, editing, setEditing, lockId }: {
  turn: SimulationTurn; stage: StageViewModel; workId: string; episode: number; editing: Editing; setEditing: (value: Editing) => void; lockId: string
}) {
  const nameId = useId()
  const narration = turn.kind === 'narration'
  const monologue = turn.kind === 'monologue'
  const owner = monologue ? monologueOwner(turn, stage.names) : turn.characterName
  const mine = editing?.turn === turn.index ? editing : null
  const edited = turn.editedByAuthor && <span className="stage-edited">작가 수정</span>
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (mine && await stage.edit(turn.index, mine.text)) setEditing(null)
  }
  return <li className={`stage-turn${narration ? ' stage-narration' : monologue ? ' stage-monologue' : ''}`} data-kind={turn.kind}>
    {narration
      ? <p className="stage-who" id={nameId}><span className="sr-only">나레이션</span>{edited}</p>
      : <p className="stage-who" id={nameId}>{owner}{monologue && <span className="stage-tag">속마음</span>}{edited}</p>}
    {mine
      ? <form className="stage-edit" aria-live="off" onSubmit={save}>
        <label className="sr-only" htmlFor={`${nameId}-edit`}>{narration ? '나레이션' : monologue ? `${owner} 속마음` : owner} 줄 고치기</label>
        <textarea id={`${nameId}-edit`} rows={4} value={mine.text} maxLength={2000} autoFocus
          onChange={(e) => setEditing({ turn: turn.index, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }} />
        <div className="stage-edit-actions">
          <button type="submit" className="btn sm pri" disabled={!stage.canAct || !mine.text.trim() || mine.text.trim() === turn.prose.trim()}>수정 저장</button>
          <button type="button" className="btn sm" onClick={() => setEditing(null)}>수정 취소</button>
        </div>
        <p className="chat-note">고친 줄은 작가가 쓴 글로 남고 검사 결과는 지워져요. 모델 호출은 없어요.</p>
      </form>
      : <div className="stage-bubble"><ManuscriptBody workId={workId} number={episode} body={turn.prose} /></div>}
    {!mine && stage.showActions && <div className="stage-actions" aria-live="off">
      <button type="button" aria-describedby={stage.linesLock ? lockId : nameId} disabled={!stage.canAct}
        onClick={() => { stage.pause(); setEditing({ turn: turn.index, text: turn.prose }) }}>수정</button>
      <button type="button" aria-describedby={stage.linesLock ? lockId : nameId} disabled={!stage.canAct} onClick={() => void stage.redo(turn.index)}>다시 말하기</button>
    </div>}
    {!turn.editedByAuthor && (turn.kind === 'character' || !!turn.checks.length || !!turn.evidence.length) && <Checks turn={turn} />}
  </li>
}

/** 진행 중이거나 끝난 장면: 대본(실시간 추가·자동 스크롤) → 진행 조작·끼어들기 → 원고 반영 또는 결과. */
function Scene({ stage, sim, workId, episode }: { stage: StageViewModel; sim: CharacterSimulation; workId: string; episode: number }) {
  const id = useId()
  const [editing, setEditing] = useState<Editing>(null)
  const [note, setNote] = useState('')
  const script = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // 새 줄이 붙으면, 맨 아래에서 읽던 대본만 따라 내려간다(위로 올려 읽는 중이면 그대로 둔다).
  useEffect(() => {
    const el = script.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [stage.rows.length])
  const lockId = `${id}-lock`
  const stopped = sim.status === 'stopped' || sim.status === 'failed'
  return <>
    {sim.premise && <p className="stage-premise">{sim.premise}</p>}
    {!!sim.beats.length && <ol className="stage-beats" aria-label="흐름 비트">{sim.beats.map((beat) => <li key={beat.index} data-status={beat.status}>{beat.text}<span>{beatLabel[beat.status]}</span></li>)}</ol>}
    <div ref={script} className="stage-script"
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
      <ol className="stage-turns" aria-label="장면 대본" aria-live="polite">
        {stage.rows.map((row, i) => row.kind === 'note'
          ? <li key={`note-${i}`} className="stage-note"><b>작가 끼어들기</b> <span>{row.note.text}</span></li>
          : row.kind === 'pov'
            ? <li key={`pov-${i}`} className="stage-pov">{row.text}</li>
            : <Turn key={`turn-${row.turn.index}`} turn={row.turn} stage={stage} workId={workId} episode={episode} editing={editing} setEditing={setEditing} lockId={lockId} />)}
      </ol>
      {!stage.rows.length && <p className="chat-note">아직 만들어진 장면이 없어요.</p>}
    </div>
    {stopped && sim.stopReason && <p className="stage-reason"><b>{sim.status === 'stopped' ? '멈춘 이유' : '실패 이유'}</b> {sim.stopReason}</p>}
    {stage.hint && <p className="chat-note" role="status">{stage.hint}</p>}
    {stage.linesLock && <p id={lockId} className="chat-note">{stage.linesLock}</p>}
    {stage.retryNote && <p className="chat-note">{stage.retryNote}</p>}
    {stage.live && <div className="stage-controls" role="group" aria-label="장면 진행">
      <button type="button" className="btn sm" disabled={!stage.playing && !!stage.blocked} onClick={stage.playing ? stage.pause : stage.play}>{stage.playing ? '일시정지' : '재생'}</button>
      <button type="button" className="btn sm" disabled={stage.finishing || (!stage.pending && !!stage.blocked)} onClick={stage.finish}>{stage.finishing ? '끝내는 중…' : '장면 끝내기'}</button>
    </div>}
    {stage.canNote && <>
      <form className="stage-note-form" onSubmit={(e) => { e.preventDefault(); if (stage.leaveNote(note)) setNote('') }}>
        <label htmlFor={`${id}-note`}>끼어들기 <small>다음 턴부터 반영돼요</small></label>
        <input id={`${id}-note`} value={note} maxLength={300} placeholder="예: 이때 카엘이 갑자기 문을 걷어찬다" onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="btn sm" disabled={!note.trim()}>남기기</button>
      </form>
      {stage.queued && <p className="stage-queued" role="status">다음 턴에 반영할 끼어들기: “{stage.queued}” <button type="button" className="chat-link" aria-label="끼어들기 취소" onClick={stage.clearNote}>취소</button></p>}
    </>}
    {stage.approvable && <section className="stage-review" aria-label="원고 반영">
      <p className="stage-review-title">이 장면을 {stage.target}에 반영할까요?</p>
      <p className="chat-note">승인하면 이 장면이 {stage.target} 뒤에 이어 붙어요. 이어 붙는 글은 약 {stage.approveChars.toLocaleString('ko-KR')}자예요. 반영하기 전에는 원고가 바뀌지 않고, 반영하지 않아도 장면은 대화에 남아요.</p>
      <div className="stage-review-actions">
        <button type="button" className="btn pri" disabled={!stage.canAct} onClick={() => void stage.approve()}>원고에 반영</button>
        <button type="button" className="btn" disabled={!stage.canAct} onClick={() => void stage.decline()}>반영하지 않기</button>
        <button type="button" className="btn" disabled={!stage.canAct} onClick={() => void stage.continueScene()}>장면 이어 가기</button>
      </div>
    </section>}
    {stage.result && <p className="stage-result" role="status">{stage.result}</p>}
    {!stage.live && !stage.approvable && !stage.pending && <div className="stage-again"><button type="button" className="btn sm" onClick={stage.compose}>새 시뮬레이션</button></div>}
    <Consent stage={stage} />
  </>
}

/**
 * 집필실 중앙의 시뮬레이션 무대(#58, 모달 아님: 열려 있는 동안 편집기를 대신한다). 서버→화면은 기존 SSE, 화면→서버 조작은 resume 요청이다.
 * 나레이션은 메인 에이전트(나레이터)가, 인물 줄은 인물 에이전트가 쓰고 작가가 줄을 고치거나 그 줄만 다시 말하게 할 수 있다.
 * 상태는 모두 stage(ViewModel)가 정하고, 장면이 없으면 시작 양식을 보인다.
 * planEpisode는 흐름 비트를 읽는 열린 회차, episode는 본문 서식(이미지 표식) 해석용 회차, plotLink는 장면 계획을 만드는 곳으로 가는 링크(호스트가 이동 확인을 맡는다).
 * headingRef는 호스트가 사용자가 무대를 연 때만 제목으로 초점을 옮기려고 받는다(저절로 열린 무대는 초점을 빼앗지 않는다).
 */
export function SimulationStage({ stage, workId, episode, planEpisode, plotLink, headingRef, onClose }: {
  stage: StageViewModel; workId: string; episode: number; planEpisode: number | null; plotLink: ReactNode; headingRef?: Ref<HTMLHeadingElement>; onClose: () => void
}) {
  const id = useId()
  const sim = stage.showForm ? null : stage.simulation
  return <section className="stage" aria-labelledby={`${id}-h`}>
    <header className="stage-head">
      <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1}>인물 시뮬레이션 무대</h2>
      {sim && <span className="stage-status" data-status={stage.statusKey}>{stage.statusText}</span>}
      <button type="button" className="btn sm" onClick={onClose}>무대 닫기</button>
    </header>
    {stage.error && <div className="chat-error" role="alert"><p>{stage.error}</p><button type="button" className="btn sm" onClick={stage.reload}>다시 불러오기</button></div>}
    {sim ? <Scene stage={stage} sim={sim} workId={workId} episode={episode} /> : <StartForm stage={stage} workId={workId} planEpisode={planEpisode} plotLink={plotLink} />}
  </section>
}
