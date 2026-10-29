import { useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'

import { toast } from '../../../shared/events'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { Sheet } from '../../../shared/Sheet'
import { useStudioViewModel } from '../viewmodel/useStudioViewModel'

type VM = ReturnType<typeof useStudioViewModel>
const readParas = (el: HTMLElement) => {
  const ps = [...el.querySelectorAll('p')]
  return (ps.length ? ps.map((p) => (p.textContent ?? '').trim()) : (el.textContent ?? '').split(/\n+/).map((x) => x.trim())).filter(Boolean)
}

/**
 * 목업 studio(id): U13 집필실 원고 화면.
 * ponytail: 원고·AI 도움 탭만 옮겼어요. 보기 전환(보드·사전·개요·서술·메모), 타임라인·설정 탭, 미리 보기·인물 시뮬레이션·자율 연재는 다음 단계예요.
 */
export function StudioPage() {
  const { id = '' } = useParams()
  const [q] = useSearchParams()
  const ep = Number(q.get('ep')) || undefined
  const vm = useStudioViewModel(id, ep)
  const { data, studio: s, draft: d } = vm
  if (data === undefined) return null
  if (data === null) return <><Gnb on="lib" /><main className="wrap"><div className="panel"><h1>소설을 찾을 수 없거나 볼 수 없어요.</h1><Go to="/lib?tab=write" className="btn">내가 쓰는 소설</Go></div></main><Footer /></>
  if (!s || !d) {
    const w = data.work
    return (
      <>
        <Gnb on="lib" />
        <main className="wrap"><div className="tcard" style={{ maxWidth: 560, margin: '60px auto', padding: 32, textAlign: 'center' }}>
          <h2 style={{ fontSize: 21, fontWeight: 800 }}>내 소설만 쓸 수 있어요</h2>
          <p className="muted" style={{ margin: '10px 0 20px' }}>「{w.title}」 — {w.author}님의 소설이에요. 이 소설에서 포크해 나만의 전개를 쓰고 싶다면 포크를 이용해 주세요.</p>
          <div className="rowend" style={{ justifyContent: 'center' }}><Go to={`/work/${w.id}`} className="btn">소설 보기</Go>{!w.parent && w.forksAllowed && <Go to={`/fork/${w.id}`} className="btn pri">✎ 포크하기</Go>}</div>
        </div></main>
        <Footer />
      </>
    )
  }
  const w = s.work
  const selected = d.editingEpisode ?? 0
  const ro = vm.readOnly
  return (
    <div className={`calm rd calm-${w.theme} studio`}>
      <div className="sbar">
        <Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><span className="t">{w.title}</span>
        <span className={`st${vm.saving ? ' saving' : ''}`} id="saved"><i />{vm.saving ? '저장 중…' : '저장됨'}</span>
        <button type="button" className="tbtn pri" style={{ height: 40 }} id="pubep" disabled={ro} onClick={vm.openPublish}>{ro ? '원작 원고' : d.editingEpisode ? '수정 공개하기' : '공개하기'}</button>
      </div>
      <div className="sgrid">
        <nav className="seps"><div className="lab">회차</div>
          {s.eps.map((x, i) => {
            const snap = !!w.parent && i < (w.forkAt ?? 0)
            return (
              <span key={i} style={{ display: 'contents' }}>
                <Go to={`/studio/${id}?ep=${i + 1}`} className={selected === i + 1 ? 'on' : ''} aria-current={selected === i + 1 ? 'page' : 'false'} aria-label={`${i + 1}화 ${x.t} 원고`}>{i + 1}화 {x.t}<small>{snap ? '원작 스냅샷 (수정 불가)' : x.hidden ? '공개 중단' : '발행됨'}</small></Go>
                {!snap && <button type="button" className="btn sm" onClick={() => vm.toggleEpisode(i - (w.parent ? w.forkAt ?? 0 : 0))}>{x.hidden ? '회차 다시 공개' : '회차 공개 중단'}</button>}
              </span>
            )
          })}
          <Go to={`/studio/${id}`} className={selected ? '' : 'on'}>{s.current.no}화 {s.current.title}<small>쓰는 중 · 비공개</small></Go>
        </nav>
        <Editor vm={vm} />
        <aside className="side"><div className="stabs"><button type="button" className="on">AI 도움</button></div><AiPanel vm={vm} /></aside>
      </div>
      {vm.publishing && <PublishEpisodeSheet vm={vm} />}
    </div>
  )
}

/** 사용자가 직접 고치는 영역이라 React가 자식을 관리하지 않도록 DOM으로 채웁니다 (어긋난 문장은 강조). */
const filled = new WeakSet<HTMLElement>()
function fillBody(el: HTMLElement, paras: string[], bad: string[]) {
  for (const t of paras) {
    const p = document.createElement('p')
    const s = bad.find((x) => t.includes(x))
    if (s) {
      const span = document.createElement('span')
      span.className = 'conflict'
      span.textContent = s
      p.append(t.slice(0, t.indexOf(s)), span, t.slice(t.indexOf(s) + s.length))
    } else p.textContent = t
    el.append(p)
  }
}

function Editor({ vm }: { vm: VM }) {
  const d = vm.draft!
  const ro = vm.readOnly
  const bad = d.check?.issues.map((x) => x.sent) ?? []
  const image = useRef<HTMLInputElement>(null)
  return (
    <section className="editor">
      <input className="et" id="et" defaultValue={d.title} key={vm.bodyKey + 't'} aria-label="회차 제목" disabled={ro} onInput={(e) => vm.edit({ title: e.currentTarget.value })} />
      <div className="tip">{d.no}화 · @를 입력하면 인물·사건을 연결할 수 있어요</div>
      {d.editingEpisode && !ro ? <div className="revision-note">공개 원고를 복사한 수정 초안이에요. 수정 내용은 ‘수정 공개하기’를 누르기 전까지 공개 원고에 반영되지 않아요.</div>
        : ro ? <div className="revision-note">원작 스냅샷 원고는 읽기 전용이에요. Fork 이후 회차부터 수정할 수 있어요.</div> : null}
      {d.auto && <div className="abanner">🤖 AI 자율 연재가 쓴 초안이에요. 읽어 보고 고친 뒤 직접 공개해 주세요.</div>}
      <div className="eb" id="eb" key={vm.bodyKey} contentEditable={!ro} suppressContentEditableWarning spellCheck={false} role="textbox" aria-multiline="true" aria-label="원고 본문"
        data-ph={`여기에 ${d.no}화를 써 보세요. 오른쪽 AI 도움으로 시작할 수도 있어요.`} onInput={(e) => vm.edit({ paras: readParas(e.currentTarget) })}
        ref={(el) => { if (el && !filled.has(el)) { filled.add(el); fillBody(el, d.paras, bad) } }}>
      </div>
      <label className="field author-note-editor">작가의 말<textarea className="ta" id="authorNote" key={vm.bodyKey + 'n'} aria-label="작가의 말" placeholder="회차를 읽은 독자에게 전할 말을 적어 주세요" disabled={ro} defaultValue={d.authorNote} onInput={(e) => vm.edit({ authorNote: e.currentTarget.value })} /></label>
      <div className="wordtools"><output id="wordcount" aria-live="polite">{vm.wordCount}</output><div className="acts">
        <button type="button" className="btn sm" disabled={ro} onClick={() => image.current?.click()}>이미지 삽입</button>
        <input ref={image} type="file" accept="image/*" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          if (!/^image\//.test(f.type)) return toast('이미지 파일을 골라 주세요')
          const r = new FileReader()
          r.onload = () => { const eb = document.getElementById('eb'); eb?.focus(); document.execCommand('insertImage', false, String(r.result)); toast('이미지 미리보기예요. 저장·발행·내보내기에는 포함되지 않아요') }
          r.onerror = () => toast('이미지를 읽지 못했어요')
          r.readAsDataURL(f)
        }} />
        <button type="button" className="btn sm" onClick={() => vm.download(false)}>이 회차 txt</button>
        <button type="button" className="btn sm" onClick={() => vm.download(true)}>전체 원고 txt</button>
        <button type="button" className="btn sm" onClick={() => toast('EPUB는 회차·메타데이터·이미지를 포함해야 해요. 이 데모에서는 TXT 내보내기만 지원합니다.')}>EPUB(.epub) 내보내기</button>
      </div></div>
      <p className="small muted">이미지는 이 화면에서 임시 삽입만 할 수 있으며 저장·발행·내보내기에 포함되지 않아요. EPUB에는 회차·메타데이터·이미지가 포함되어야 하지만 이 데모는 TXT만 생성해요.</p>
    </section>
  )
}

function AiPanel({ vm }: { vm: VM }) {
  const s = vm.studio!, d = vm.draft!
  const ro = vm.readOnly
  const [prompt, setPrompt] = useState(d.aiPrompt ?? '')
  const c = d.check
  return (
    <div className="spanel">
      <div className="ai-context" aria-label="AI 문맥"><span>현재 회차 · {d.no}화 {d.title}</span><span>세계관 · {s.base.rules.length}개</span><span>인물 · {s.base.cast.length}명</span></div>
      <label className="field ai-composer">AI에게 요청<textarea className="ta" id="aiPrompt" rows={3} placeholder="예: 장면의 긴장감을 살려 이어 써 주세요" disabled={ro} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
      <button type="button" className="aib" id="btnProp" disabled={ro} onClick={() => vm.propose(prompt)}><span className="ic">✍</span><div><b>장면 이어쓰기</b><span>작성한 요청과 현재 원고 문맥으로 초안을 제안해요</span></div><em>예시 5<br />미확정</em></button>
      <button type="button" className="aib" id="btnCheck" disabled={ro} onClick={vm.check}><span className="ic">🔍</span><div><b>설정 검사</b><span>세계관 규칙과 어긋난 곳을 찾아요</span></div><em>예시 5<br />미확정</em></button>
      {d.proposal === 'shown' && (
        <div className="aiprev" id="aiprev" role="region" aria-label="AI 제안 미리보기">
          <small>AI 응답 · 장면 이어쓰기 예시 · 원고에 넣기 전에는 반영되지 않아요</small>
          <p className="ai-request"><b>요청</b> {d.aiPrompt || '현재 장면을 이어 써 주세요'}</p>
          {s.proposal.map((t) => <p key={t} style={{ margin: '0 0 .6em' }}>{t}</p>)}
          <div className="r"><button type="button" className="btn sm pri" id="acceptAI" onClick={vm.accept}>원고에 넣기</button><button type="button" className="btn sm" onClick={vm.drop}>버리기</button></div>
        </div>
      )}
      {!c ? <div className="chk idle">설정 검사는 선택 사항이에요. 필요하면 실행해 주세요.</div>
        : c.stale ? <div className="chk idle">소설이 바뀌었어요. 설정 검사를 다시 실행해 주세요.</div>
        : c.issues.length ? (
          <div className="chk bad" id="chkres"><b>⚠ {c.issues.length}곳이 설정과 어긋나요</b>{c.issues.map((x, i) => (
            <div key={i} style={{ marginTop: 8 }}>“{x.sent.slice(0, 40)}…”<br /><span className="note2">규칙: {x.rule}</span>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}><button type="button" className="btn sm" onClick={() => vm.fix(i)}>제안대로 고치기</button><button type="button" className="btn sm" onClick={() => vm.ignore(i)}>의도한 거예요</button></div></div>
          ))}</div>
        ) : <div className="chk ok" id="chkres"><b>✓ 설정과 어긋난 곳이 없어요</b><br /><span className="note2">규칙 {s.base.rules.length}개 · 인물 {s.base.cast.length}명 기준 (이 소설의 스냅샷)</span></div>}
      <p className="note2">숫자는 예시예요. 데모 잔액만 바뀌고 실제 차감은 없어요<br />응답은 고정 예시이며 입력은 외부 AI로 전송되지 않아요. 제안은 ‘원고에 넣기’를 눌러야 반영돼요. 일러스트 생성은 MVP에서 제외됐어요.</p>
    </div>
  )
}

/** 목업 pubEpSheet(): U22 회차 공개 */
function PublishEpisodeSheet({ vm }: { vm: VM }) {
  const s = vm.studio!, d = vm.draft!, w = s.work
  const [title, setTitle] = useState(d.title)
  const ready = d.paras.length > 0
  const checked = !!d.check && !d.check.stale
  const clean = checked && !d.check!.issues.length
  const label = d.editingEpisode ? '수정 공개하기' : '공개하기'
  return (
    <Sheet sid="U22" label={`${d.no}화 ${label}`} onClose={vm.closePublish}>
      <div className="sh-h"><h3>{d.no}화 {label}</h3><button type="button" className="x" aria-label="닫기" onClick={vm.closePublish}>✕</button></div>
      <label className="field">회차 제목<input className="inp" id="pubt" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <div className="list" style={{ borderRadius: 16 }}>
        <div className="rp"><div className="top"><b>소설</b><span className={`chip ${ready ? 'ok' : 'wait'}`}>{ready ? d.paras.length + '문단' : '비어 있음'}</span></div></div>
        <div className="rp"><div className="top"><b>설정 검사</b><span className={`chip ${clean ? 'ok' : 'wait'}`}>{!checked ? '선택 사항' : clean ? '통과' : d.check!.issues.length + '곳 확인 필요'}</span></div></div>
        <div className="rp"><div className="top"><b>공개 대상</b><span className="chip ok">{w.private ? '작품 비공개 · 나만 보기' : w.parent ? '포크 · 원작 링크 표시' : '모두'}</span></div></div>
      </div>
      {!ready ? <div className="policy">소설을 먼저 써 주세요.</div> : !clean ? <div className="note2">설정 검사는 선택 사항이에요. 확인하지 않아도 공개할 수 있어요.</div> : <div className="note">발행 후 공개 범위는 작품 설정을 따릅니다. 원작은 바뀌지 않아요.</div>}
      <div className="rowend">
        <button type="button" className="btn" onClick={vm.closePublish}>취소</button>
        {ready && !clean && <button type="button" className="btn" onClick={async () => { if (await vm.check()) vm.closePublish() }}>설정 검사 하기</button>}
        <button type="button" className="btn pri" id="doPub" disabled={!ready} onClick={() => vm.publish(title)}>{label}</button>
      </div>
    </Sheet>
  )
}
