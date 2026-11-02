import type {StoryContext} from '../../../../domain/entities/content'

export function ContextPreview({value}:{value:StoryContext}) {
 return <section className="ep-context" aria-label="조회한 문맥"><h3>{value.basisEpisode}화 기준 문맥</h3>
  <p>{value.character?`${value.character}의 지식만 사용 · 원고 전문 제외`:'작가 시점 · 허용된 설정과 원문 발췌'} · 설정 {value.settings.length}개</p>
  <p>원문 {value.selection.omittedCharacters.toLocaleString()}자는 이번 전송에서 제외돼요. 저장된 원고는 그대로 유지돼요.</p>
  <p>{value.selection.note}</p>
  {value.settings.map(s=><details key={s.id}><summary>{s.name} · {s.fromEpisode}화 · {s.visibility==='public'?'공개':'비공개'}</summary><p>{s.content}</p><small>근거: {s.evidence||'미기재'} · 버전 {s.versionId.slice(0,8)}</small></details>)}
  {value.episodes.map(e=><details key={e.number}><summary>{e.number}화 · {e.title} · 발췌 {e.excerpts.reduce((n,s)=>n+s.text.length,0).toLocaleString()} / {e.sourceCharacters.toLocaleString()}자</summary>{e.excerpts.map(s=><div key={s.start}><small>원문 문자 {s.start}–{s.end}</small><p>{s.text}</p></div>)}</details>)}
  {value.draft&&<details><summary>현재 작성 원고 · {value.draft.length.toLocaleString()}자</summary><p>{value.draft}</p></details>}
 </section>
}
