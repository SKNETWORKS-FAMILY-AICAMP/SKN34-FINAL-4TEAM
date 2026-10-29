import { useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import { LINE } from '../../../../domain/entities/wiki'
import { openPolicy, toast } from '../../../shared/events'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { Sheet } from '../../../shared/Sheet'
import { useStudioViewModel } from '../viewmodel/useStudioViewModel'
import { PublishSettingsSheet, SimSheet } from './StudioSheets'
import { BoardView, MemoView, NarrativeView, OverviewView, StudioTools, WikiView } from './StudioViews'

type VM = ReturnType<typeof useStudioViewModel>
const readParas = (el: HTMLElement) => {
  const ps = [...el.querySelectorAll('p')]
  return (ps.length ? ps.map((p) => (p.textContent ?? '').trim()) : (el.textContent ?? '').split(/\n+/).map((x) => x.trim())).filter(Boolean)
}

const VIEW_ID: Record<string, string> = { board: 'U37', wiki: 'U38', overview: 'U39', narrative: 'U40', memo: 'U41' }

/** 목업 studio(id): U13 집필실. view(보드·사전·개요·서술·원고·메모)와 원고 보기의 tab(ai·tl·note)을 주소로 고릅니다. */
export function StudioPage() {
  const { id = '' } = useParams()
  const [q] = useSearchParams()
  const navigate = useNavigate()
  const ep = Number(q.get('ep')) || undefined
  const view = VIEW_ID[q.get('view') ?? ''] ? q.get('view')! : 'write'
  const tab = q.get('tab') === 'tl' || q.get('tab') === 'note' ? q.get('tab')! : 'ai'
  const vm = useStudioViewModel(id, ep, VIEW_ID[view] ?? (tab === 'tl' ? 'U18' : tab === 'note' ? 'U19' : 'ai'))
  const [sim, setSim] = useState(false)
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
  const publishSettings = q.get('publish') === '1' && !w.parent
  const closeSettings = () => navigate(`/studio/${id}`, { replace: true })
  if (view !== 'write') {
    const V = { board: BoardView, wiki: WikiView, overview: OverviewView, narrative: NarrativeView, memo: MemoView }[view]!
    return (
      <div className={`calm rd calm-${w.theme} studio`}>
        <div className="sbar"><Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><span className="t">{w.title}</span><StudioTools id={id} view={view} ep={ep} /><span className={`st${vm.saving ? ' saving' : ''}`} id="saved"><i />저장됨</span></div>
        <div className="sview"><V vm={vm} /></div>
      </div>
    )
  }
  const tabTo = (t: string) => `/studio/${id}?tab=${t}${ep ? `&ep=${ep}` : ''}`
  return (
    <div className={`calm rd calm-${w.theme} studio`}>
      <div className="sbar">
        <Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><span className="t">{w.title}</span>
        <StudioTools id={id} view="write" ep={ep} />
        <span className={`st${vm.saving ? ' saving' : ''}`} id="saved"><i />{vm.saving ? '저장 중…' : '저장됨'}</span>
        <button type="button" className="tbtn" style={{ height: 40 }} disabled={ro} onClick={vm.preview}>미리 보기</button>
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
        <aside className="side"><div className="stabs">{([['ai', 'AI 도움'], ['tl', '타임라인'], ['note', '설정']] as const).map(([k, l]) => <Go key={k} to={tabTo(k)} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined}>{l}</Go>)}</div>
          {tab === 'ai' ? <AiPanel vm={vm} onSim={() => setSim(true)} /> : tab === 'tl' ? <TimelinePanel vm={vm} /> : <NotePanel vm={vm} />}</aside>
      </div>
      {vm.publishing && <PublishEpisodeSheet vm={vm} />}
      {sim && <SimSheet vm={vm} onClose={() => setSim(false)} />}
      {publishSettings && <PublishSettingsSheet vm={vm} onClose={closeSettings} />}
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

function AiPanel({ vm, onSim }: { vm: VM; onSim: () => void }) {
  const s = vm.studio!, d = vm.draft!
  const ro = vm.readOnly
  const [prompt, setPrompt] = useState(d.aiPrompt ?? '')
  const c = d.check
  return (
    <div className="spanel">
      <AutoBox vm={vm} />
      <div className="ai-context" aria-label="AI 문맥"><span>현재 회차 · {d.no}화 {d.title}</span><span>세계관 · {s.base.rules.length}개</span><span>인물 · {s.base.cast.length}명</span></div>
      <label className="field ai-composer">AI에게 요청<textarea className="ta" id="aiPrompt" rows={3} placeholder="예: 장면의 긴장감을 살려 이어 써 주세요" disabled={ro} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
      <button type="button" className="aib" id="btnSim" disabled={ro} onClick={() => (s.base.cast.length < 2 ? toast('인물을 2명 이상 추가해 주세요') : onSim())}><span className="ic">🎭</span><div><b>인물에게 맡겨 보기</b><span>상황을 주면 인물들이 직접 움직여요</span></div><em>예시 30<br />미확정</em></button>
      <button type="button" className="aib" id="btnProp" disabled={ro} onClick={() => vm.propose(prompt)}><span className="ic">✍</span><div><b>장면 이어쓰기</b><span>작성한 요청과 현재 원고 문맥으로 초안을 제안해요</span></div><em>예시 5<br />미확정</em></button>
      <button type="button" className="aib" id="btnCheck" disabled={ro} onClick={vm.check}><span className="ic">🔍</span><div><b>설정 검사</b><span>세계관 규칙과 어긋난 곳을 찾아요</span></div><em>예시 5<br />미확정</em></button>
      {d.sim && <div className="ref">📎 참고 자료: 시뮬레이션 1건 — {d.sim.summary}</div>}
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
      <p className="note2">숫자는 예시예요. 데모 잔액만 바뀌고 실제 차감은 없어요 · <button type="button" className="btn sm" style={{ height: 26, padding: '0 10px' }} onClick={openPolicy}>정책 안내</button><br />응답은 고정 예시이며 입력은 외부 AI로 전송되지 않아요. 제안은 ‘원고에 넣기’를 눌러야 반영돼요. 일러스트 생성은 MVP에서 제외됐어요.</p>
    </div>
  )
}

/** 목업 autoBox(w): AI 자율 연재 (데모 · 실제 예약·AI 호출 없음) */
function AutoBox({ vm }: { vm: VM }) {
  const A = vm.auto!
  const editing = !!vm.draft!.editingEpisode
  return (
    <div className={`auto ${A.on ? 'on' : ''}`}><div className="ah"><b>🤖 AI 자율 연재</b><button type="button" className="sw" role="switch" aria-checked={A.on} aria-label={`AI 자율 연재 ${A.on ? '끄기' : '켜기'}`} id="autoSw" onClick={vm.toggleAuto}><i /></button></div>
      <p className="note2">정식 서비스에서는 AI가 세계관과, 켠 경우 이전 회차 발행 이후 필터를 통과한 공개 댓글·제안만 참고해요. 단순 오류·스토리 오류 제보와 작성자 정보는 AI에 보내지 않아요. 비용은 작품 소유자가 부담해요. 회당·월간 상한과 실제 비용은 미정이며 이 데모는 실제 AI·예약 실행·유해 콘텐츠 필터·권리 확인을 연결하지 않았어요.</p>
      {A.on && <div className="aset"><p className="small">실행 요일·시각 (KST) · 미정 <span className="demo">데모 · 실제 예약 없음</span></p>
        <label className="ck"><input type="checkbox" checked={A.react} onChange={(e) => vm.setAuto('react', e.target.checked)} /> 필터를 통과한 공개 댓글·제안만 참고 (제보·작성자 정보 제외)</label>
        <label className="ck"><input type="checkbox" checked={A.requireReview} onChange={(e) => vm.setAuto('requireReview', e.target.checked)} /> 발행 전에 작가 확인 받기</label>
        <p className="small">상태: {A.status}</p><button type="button" className="btn sm" onClick={vm.pauseAuto}>{A.status === '실행 중' ? '일시 중지' : '다시 시작'}</button>
        <div className="anext">주 1–7회, 하루 최대 1회 · KST 기준. 예정 시각에서 1시간 넘게 늦으면 건너뛰고 알림을 보내요. 이 화면은 예약 실행을 하지 않아요.</div>
        {editing && <p className="small note2">자율 연재는 새 회차 화면에서 실행할 수 있어요.</p>}
        <button type="button" className="btn sm pri" id="autoGen" style={{ width: '100%' }} disabled={editing} onClick={vm.autoGen}>지금 한 회차 생성해 보기 <span className="demo" style={{ borderColor: 'currentColor', color: 'inherit' }}>예시 · 미확정</span></button>
        {A.log.length > 0 && <div className="alog">{A.log.slice(-3).map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>)}</div>}
      </div>}
    </div>
  )
}

/** 목업 studio() tab==='tl': U18 타임라인 */
function TimelinePanel({ vm }: { vm: VM }) {
  const s = vm.studio!, d = vm.draft!, w = s.work
  const evs = s.base.events.map((x) => ({ x, orig: true })).concat((w.ownEvents ?? []).map((x) => ({ x, orig: false })))
  return (
    <div className="spanel"><div className="note2">회색 점 = 원작 스냅샷 사건 · 보라 점 = 이 소설에서 생긴 사건. 소설에서 @로 연결하면 이 회차 항목에 쌓여요.</div>
      <div className="tl">{evs.map(({ x: [ep, k, t, who], orig }, i) => (
        <div className={`tle ${orig ? 'orig' : ''}`} key={i}><small>{ep}화{orig && w.parent ? ' · 원작 스냅샷' : ''}</small><div><span className={`k ${k}`}>{LINE[k]}</span>{t}<div className="who">{who.map((c, j) => <span key={j}>▲ {c}</span>)}</div></div></div>
      ))}
        <div className="tle"><small>{d.no}화 · 지금 쓰는 중</small><div><span className="k m">메인</span>{d.title}<div className="who">{d.links.length ? d.links.map((c) => <span key={c}>@ {c}</span>) : <span>아직 연결 없음</span>}</div></div></div></div>
      <button type="button" className="tbtn" style={{ height: 40 }} disabled={vm.readOnly} onClick={vm.addEvent}>＋ 사건 추가</button>
    </div>
  )
}

/**
 * 목업 studio() tab==='note': U19 설정 노트.
 * ponytail: 규칙·인물 상태만 옮겼어요. 세계관 자동 업데이트·표기 오류 자동 승인·설정 추출·독자 공개 시작 회차는 세계관 저장 구조와 함께 옮겨요.
 */
function NotePanel({ vm }: { vm: VM }) {
  const s = vm.studio!, w = s.work
  return (
    <div className="spanel nt">
      <Go to={`/studio/${w.id}?view=wiki`} className="btn sm">📖 사전에서 인물·세계관 자세히 관리 →</Go>
      <h4>세계관 규칙 {w.parent ? '(스냅샷)' : ''}</h4><ul>{s.base.rules.map((r) => <li key={r}>{r}</li>)}</ul>
      <h4>인물 상태 {w.parent ? `· ${w.forkAt}화 시점에서 복사` : ''}</h4>
      {s.base.cast.map((c, i) => (
        <div className="pc" key={c.n}><i style={{ background: c.c }} /><div><b>{c.n}</b><span>{c.d}</span></div>
          <select aria-label={`${c.n} 상태`} value={c.st} onChange={(e) => vm.setCastStatus(i, e.target.value)}>{['흔들림', '결심', '엄격', '호기심', '결의', '경계', '여유', '의문', '설움', '근심', '—'].map((o) => <option key={o}>{o}</option>)}</select></div>
      ))}
      <p className="note2">{w.parent ? '여기서 바꾼 상태는 이 소설의 스냅샷에만 저장돼요. 원작 값은 회색 글씨로 같이 보여요.' : '원작의 설정이에요. 이미 포크 소설들은 각자의 스냅샷을 쓰기 때문에 영향을 받지 않아요.'}</p>
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
