import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useManuscriptImportViewModel } from '../viewmodel/useManuscriptImportViewModel'
import './manuscript-import.css'

type VM = ReturnType<typeof useManuscriptImportViewModel>
type Plan = NonNullable<VM['plan']>
type Summary = NonNullable<VM['result']>

const RIGHTS = [
  '이 원고는 내가 쓴 저작물이거나, 등록할 권리를 가지고 있어요.',
  '출판 계약 등으로 이 원고의 등록·이용이 제한되지 않아요.',
  '원고에 포함된 이미지를 사용할 권한이 있어요.',
]

/** 실제 모드 `/import`: TXT·EPUB 파일을 서버에서 읽어 회차로 등록한다. 데모 화면은 `ImportPage`가 `--mode mockup`에서 그대로 맡는다. */
export function ManuscriptImportPage() {
  const vm = useManuscriptImportViewModel()
  useScreenId('U24')
  useDocumentTitle('소설 가져오기')
  return (
    <>
      <Gnb on="lib" />
      <main id="main" tabIndex={-1} className="wrap manuscript-import">
        <div className="topbar" style={{ height: 'auto', marginBottom: 14 }}><Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><h1 style={{ fontSize: 21, fontWeight: 800 }}>내 소설 가져오기</h1></div>
        {vm.result ? <ImportResult vm={vm} result={vm.result} /> : <>
          <ImportSetup vm={vm} />
          {vm.plan && <ImportPreview vm={vm} plan={vm.plan} />}
        </>}
      </main>
      <Footer />
    </>
  )
}

/** 가져오기 입력과 작품·세계관 링크를 표시한다. 링크로 이동하면 임시 입력이 사라지므로 먼저 확인한다. */
function ImportSetup({ vm }: { vm: VM }) {
  return (
    <section className="panel mi-setup" aria-label="가져올 원고 설정">
      <fieldset disabled={!!vm.busy}>
        <legend className="sr-only">원고 가져오기 설정</legend>
        <h2 className="mi-step">1. 등록할 작품</h2>
        {vm.worksLoading ? <p role="status">작품을 불러오고 있어요…</p>
          : vm.worksError ? <p role="alert">{vm.worksError} <button type="button" className="btn sm" onClick={vm.reloadWorks}>다시 불러오기</button></p>
          : !vm.works.length ? <p>서버에 저장된 작품이 없어요. 먼저 작품을 만들어 주세요. <Go to="/content" className="btn sm" onClick={(e) => { if (!vm.confirmLeave()) e.preventDefault() }}>작품 만들기</Go></p>
          : <label className="field">원고를 넣을 작품<select className="inp" value={vm.workId} onChange={(e) => vm.selectWork(e.target.value)}><option value="">작품을 선택해 주세요</option>{vm.works.map((work) => <option key={work.id} value={work.id}>{work.title}</option>)}</select></label>}
        <p className="small muted">만든 세계관은 이 작품과 연결되지 않고 세계관 작업실에 따로 저장돼요.{' '}
          <Go to="/worldstudio" className="btn sm" disabled={!!vm.busy}
            onClick={(e) => { if (!vm.confirmLeave()) e.preventDefault() }}>세계관 만들기</Go></p>
        <h2 className="mi-step">2. 권리 확인</h2>
        {RIGHTS.map((text, index) => <label key={text} className="mi-check"><input type="checkbox" checked={vm.rights[index]} onChange={(e) => vm.setRight(index, e.target.checked)} /> {text}</label>)}
        <p className="small muted">등록은 공개·발행·AI 학습 동의가 아니에요. 등록한 원고는 나만 볼 수 있는 초안·저장 버전으로 들어가요.</p>
        <h2 className="mi-step">3. 원고 파일</h2>
        <label className="field">원고 파일 (.txt, .epub)<input className="inp" type="file" accept=".txt,.epub" disabled={!vm.workId || !vm.allRights} onChange={(e) => vm.pickFile(e.target.files?.[0] ?? null)} /></label>
        <p className="small muted">작품을 고르고 권리 3가지를 확인하면 파일을 고를 수 있어요. TXT 10MB·EPUB 50MB 이하, 한 번에 300회차까지 가져와요. DRM이 걸린 EPUB은 읽을 수 없고, 지원하지 않는 형식의 이미지는 빠져요(빠지는 개수는 미리보기 경고로 알려 줘요).</p>
        <div className="rowend"><button type="button" className="btn pri" disabled={!vm.canPreview} onClick={() => void vm.preview()}>{vm.busy === 'preview' ? '미리보기를 만드는 중이에요…' : '미리보기'}</button></div>
      </fieldset>
      {/* 미리보기가 열려 있으면 진행·오류 표시는 확정 버튼 가까운 미리보기 패널이 맡는다. */}
      {!vm.plan && vm.busy && <button type="button" className="btn sm" onClick={vm.cancel}>요청 취소</button>}
      {!vm.plan && vm.error && <p role="alert">{vm.error}</p>}
    </section>
  )
}

function ImportPreview({ vm, plan }: { vm: VM; plan: Plan }) {
  const existing = plan.existingEpisodeCount
  return (
    <section className="panel mi-preview" aria-label="가져올 회차 미리보기">
      <h2>미리보기</h2>
      <p className="small muted" role="status">{plan.format.toUpperCase()} 파일에서 {plan.episodes.length}개 회차를 찾았어요. {plan.format === 'txt' ? '회차 제목 줄을 기준으로 나눴어요.' : 'EPUB 챕터 순서대로 나눴어요.'}</p>
      <p>{existing > 0
        ? `이 작품에는 이미 ${existing}화가 있어요. 번호가 겹치는 회차는 덮어쓰지 않고 새 저장 버전으로 쌓이며, 발행본은 바뀌지 않아요.`
        : '이 작품에는 아직 회차가 없어요. 아래 회차가 1화부터 새로 만들어져요.'}</p>
      <p className="small muted">회차 번호는 이 목록의 순서예요. 제외한 회차도 번호를 차지하고, 앞 회차가 없으면 뒤 회차는 등록되지 않아요.</p>
      <fieldset disabled={!!vm.busy}>
        <legend className="sr-only">회차 조정</legend>
        <ol className="mi-list">{plan.episodes.map((episode, index) => {
          const number = index + 1
          return <li key={`${episode.from}-${episode.to}`} className={`mi-episode${episode.excluded ? ' is-excluded' : ''}`}>
            <div className="mi-episode-head">
              <label className="field">{number}번째 회차 제목<input className="inp" value={episode.title} maxLength={120} required aria-invalid={!episode.title.trim()} onChange={(e) => vm.setTitle(index, e.target.value)} /></label>
              <span className={`chip ${episode.excluded ? '' : number <= existing ? 'wait' : 'ok'}`}>{episode.excluded ? '제외됨' : number <= existing ? `기존 ${number}화에 새 버전으로 쌓여요` : `${number}화로 새로 만들어요`}</span>
            </div>
            <p className="small muted">{episode.charCount.toLocaleString('ko-KR')}자 · 이미지 {episode.imageCount}개</p>
            <p className="mi-excerpt">{episode.excerpt}</p>
            {episode.warnings.length > 0 && <ul className="mi-warn">{episode.warnings.map((warning) => <li key={warning}>경고: {warning}</li>)}</ul>}
            <div className="mi-actions">
              <label className="mi-check"><input type="checkbox" aria-label={`${number}번째 회차 제외`} checked={episode.excluded} onChange={(e) => vm.setExcluded(index, e.target.checked)} /> 제외</label>
              <button type="button" className="btn sm" aria-label={`${number}번째 회차를 다음 회차와 합치기`} disabled={index === plan.episodes.length - 1 || episode.excluded || plan.episodes[index + 1].excluded} onClick={() => vm.mergeNext(index)}>다음 회차와 합치기</button>
            </div>
          </li>
        })}</ol>
        <div className="rowend"><button type="button" className="btn pri" disabled={!vm.canConfirm} onClick={() => void vm.confirm()}>{vm.busy === 'confirm' ? '등록하는 중이에요…' : `${vm.included}개 회차 등록`}</button></div>
      </fieldset>
      {vm.busy && <button type="button" className="btn sm" onClick={vm.cancel}>요청 취소</button>}
      {vm.error && <p role="alert">{vm.error}</p>}
    </section>
  )
}

function ImportResult({ vm, result: { results, failed } }: { vm: VM; result: Summary }) {
  const failures = results.filter((r) => r.status === 'failed')
  const partials = results.filter((r) => r.status === 'partial')
  const saved = results.filter((r) => r.status === 'created' || r.status === 'versioned')
  return (
    <section className="panel mi-result-panel" aria-label="원고 등록 결과">
      <h2>등록 결과</h2>
      {results.length > 0 && failed === 0 && !failures.length && !partials.length
        ? <p role="status">모든 회차를 등록했어요.</p>
        : <p role="status">{results.length}개 중 {results.length - failures.length}개를 저장했고 {failures.length}개는 저장하지 못했어요.{partials.length > 0 && ` 이미지를 일부 가져오지 못한 회차가 ${partials.length}개 있어요.`} 전체가 등록된 것은 아니에요. 아래 항목을 확인해 주세요.</p>}
      {failures.length > 0 && <section className="mi-result mi-failed" role="alert" aria-label="저장하지 못한 회차">
        <h3>저장하지 못한 회차 {failures.length}개</h3>
        <ul>{failures.map((r) => <li key={r.number}><b>{r.number}화 · {r.title}</b><span>{r.reason ?? '저장하지 못했어요.'}</span></li>)}</ul>
      </section>}
      {partials.length > 0 && <section className="mi-result mi-partial" aria-label="일부만 가져온 회차">
        <h3>본문은 저장했지만 이미지가 빠진 회차 {partials.length}개</h3>
        <ul>{partials.map((r) => <li key={r.number}><b>{r.number}화 · {r.title}</b><span>{r.reason ?? `이미지 ${r.missingImages}개를 가져오지 못했어요.`}</span></li>)}</ul>
      </section>}
      {saved.length > 0 && <section className="mi-result" aria-label="저장한 회차">
        <h3>저장한 회차 {saved.length}개</h3>
        <ul>{saved.map((r) => <li key={r.number}><b>{r.number}화 · {r.title}</b><span>{r.status === 'created' ? '새 회차로 만들었어요' : '기존 회차에 새 버전으로 저장했어요'}</span></li>)}</ul>
      </section>}
      <p className="small muted">실패한 항목은 이 화면을 떠나면 다시 볼 수 없어요. 필요하면 메모해 두세요.</p>
      <div className="rowend"><button type="button" className="btn" onClick={vm.reset}>다른 파일 가져오기</button><Go to={`/studio/${vm.workId}`} className="btn pri">집필실에서 확인</Go></div>
    </section>
  )
}
