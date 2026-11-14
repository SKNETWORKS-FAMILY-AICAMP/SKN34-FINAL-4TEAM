import { useId } from 'react'

import {
  beatLabel, checkKindLabel, checkSummary, evidenceLabel, modeLabel, statusLabel,
  type CharacterSimulation, type SimulationTurn,
} from '../../../domain/entities/characterSimulation'
import { ManuscriptBody } from '../media/MediaPanel'
import './chat.css'

/**
 * 턴 하나의 검사·근거. 접어 두어 본문 읽기를 방해하지 않는다.
 * ponytail: 근거 ref는 서버 값 그대로(카드 id·발췌 표식)다. 카드 제목으로 풀려면 화면이 세계관 스냅샷을 읽어야 해서 후속.
 */
function Checks({ turn }: { turn: SimulationTurn }) {
  const { passed, violated } = checkSummary(turn.checks)
  return <details className="sim-checks">
    <summary>검사·근거 · 통과 {passed} · 위반 {violated}</summary>
    {!!turn.checks.length && <ul className="sim-list" aria-label="검사">{turn.checks.map((check, i) => <li key={i} data-passed={check.passed}>
      <b>{checkKindLabel[check.kind]}</b> <span className="sim-verdict">{check.passed ? '통과' : '위반'}</span>{check.detail && ` ${check.detail}`}
    </li>)}</ul>}
    <p className="chat-note">다시 생성 {turn.regenerated}회</p>
    {turn.evidence.length
      ? <ul className="sim-list sim-evidence" aria-label="근거">{turn.evidence.map((e, i) => <li key={i}>{evidenceLabel[e.source]} · {e.ref}</li>)}</ul>
      : <p className="chat-note">찾은 근거가 없어요.</p>}
  </details>
}

/**
 * 인물 시뮬레이션(#58) 장면 카드: 머리(모드·상태) → 턴마다 인물 이름과 웹소설 문단 + 접힌 검사·근거 → 멈춤·실패 이유.
 * 본문은 공용 ManuscriptBody가 원고 기본 서식(DEC-48)대로 그린다. 진행 중에는 같은 단계의 새 결과가 올 때마다 턴이 이어서 늘어난다.
 * workId·episode는 ManuscriptBody의 이미지 표식 해석용이다(장면 본문에는 이미지가 없다).
 */
export function SceneCard({ simulation: sim, workId, episode }: { simulation: CharacterSimulation; workId: string; episode: number }) {
  const id = useId()
  return <section className="sim-card" aria-labelledby={`${id}-h`}>
    <header className="sim-head">
      <h4 id={`${id}-h`}>{modeLabel(sim)}</h4>
      <span className="sim-status" data-status={sim.status}>{statusLabel[sim.status]}</span>
    </header>
    {sim.premise && <p className="sim-premise">{sim.premise}</p>}
    {!!sim.beats.length && <ol className="sim-beats" aria-label="흐름 비트">{sim.beats.map((beat) => <li key={beat.index} data-status={beat.status}>{beat.text}<span>{beatLabel[beat.status]}</span></li>)}</ol>}
    {sim.turns.length
      ? <ol className="sim-turns">{sim.turns.map((turn) => <li key={turn.index}>
        <p className="sim-who">{turn.characterName}</p>
        <div className="sim-prose"><ManuscriptBody workId={workId} number={episode} body={turn.prose} /></div>
        <Checks turn={turn} />
      </li>)}</ol>
      : <p className="chat-note">아직 만들어진 장면이 없어요.</p>}
    {(sim.status === 'stopped' || sim.status === 'failed') && sim.stopReason && <p className="sim-reason"><b>{sim.status === 'stopped' ? '멈춘 이유' : '실패 이유'}</b> {sim.stopReason}</p>}
    {sim.status === 'stopped' && <p className="chat-note">흐름 수정이나 다시 시도는 채팅으로 요청해 주세요.</p>}
  </section>
}
