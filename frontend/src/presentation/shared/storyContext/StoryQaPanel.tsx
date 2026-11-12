import { useStoryQaViewModel } from './useStoryQaViewModel'

export function StoryQaPanel({ workId, episode, versionId, owner = false }: { workId: string; episode: number; versionId: string; owner?: boolean }) {
  const vm = useStoryQaViewModel(workId, episode, versionId, owner)
  const answer = vm.answer
  return <details className="author-note manuscript-qa">
    <summary>작품에 질문하기</summary>
    <form onSubmit={(event) => { event.preventDefault(); void vm.submit() }}>
      <label>질문 대상<select value={vm.target} disabled={vm.pending} onChange={(event) => vm.chooseTarget(event.target.value)}>
        <option value="manuscript">발행 원고</option>
        <option value="setting">{owner ? '저장된 설정' : '공개 설정'}</option>
        {owner && <option value="relationship">현재 인물 관계</option>}
      </select></label>
      {vm.target === 'manuscript' && <p>{episode}화까지 발행된 원고에서 근거를 찾아요.</p>}
      {vm.target === 'setting' && <p>{episode}화 기준으로 열람할 수 있는 설정에서 근거를 찾아요.</p>}
      {vm.target === 'relationship' && <p>연결한 세계관의 현재 관계를 사용해요. 기준 회차 시점의 관계는 확인할 수 없어요.</p>}
      {!owner && <p>현재 인물 관계 질문은 집필실에서 작가에게만 제공돼요.</p>}
      <label>질문<textarea value={vm.question} onChange={(event) => vm.setQuestion(event.target.value)}
        required maxLength={500} rows={3} disabled={vm.pending} /></label>
      <label className="ck"><input type="checkbox" checked={vm.consent} disabled={vm.pending}
        onChange={(event) => vm.setConsent(event.target.checked)} />질문과 선택한 대상의 근거를 OpenAI에 전송하는 데 동의해요. API 사용 비용이 발생해요.</label>
      <button type="submit" className="tbtn pri" disabled={!vm.question.trim() || !vm.consent || vm.pending}>질문 보내기</button>
    </form>
    {vm.pending && <p role="status">근거를 찾고 답변을 작성하고 있어요.</p>}
    {vm.error && <p role="alert">{vm.error}</p>}
    <div aria-live="polite">{answer && <>
      <h3>답변</h3>
      {answer.claims.length === 0 && <p>확인된 근거로 답하기 어려워요.</p>}
      {answer.claims.map((claim, index) => <p key={index}>
        <strong>{claim.kind === 'inferred' ? '추론' : '근거 확인'}</strong> <span>{claim.text}</span>{' '}
        {[...new Set(claim.sourceIds)].map(id => <a key={id} href={`#qa-source-${id}`}>[{answer.sources.findIndex(source => source.id === id) + 1}]</a>)}
      </p>)}
      {answer.sources.length > 0 && <>
        <h3>출처</h3>
        <ol>{answer.sources.map(source => <li key={source.id} id={`qa-source-${source.id}`}>
          {source.kind === 'manuscript' && <span>{source.episode}화 · 판본 {source.versionId}</span>}
          {source.kind === 'setting' && <span>설정 · {source.title} · {source.episode}화 기준 · 판본 {source.versionId}</span>}
          {source.kind === 'relationship' && <span>현재 관계 · {source.title} · 그래프 토큰 {source.graphVersion}</span>}
          <blockquote>{source.quote}</blockquote>
        </li>)}</ol>
      </>}
      {answer.gaps.length > 0 && <>
        <h3>근거가 부족한 부분</h3>
        <ul>{answer.gaps.map((gap, index) => <li key={index}>{gap.detail}</li>)}</ul>
        {answer.coverage.withoutVerifiedExcerpt.length > 0 && <p>
          근거를 확인하지 못한 회차 {answer.coverage.withoutVerifiedExcerpt.map(ref => `${ref.number}화`).join(', ')}
        </p>}
      </>}
    </>}</div>
  </details>
}
