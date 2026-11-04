import { useRef,useState } from 'react'
import { useWritingViewModel } from '../viewmodel/useWritingViewModel'
import './writing.css'
import { useScreenId } from '../../../shared/screenIds'
import {ManuscriptBody} from '../../../shared/media/MediaPanel'

export function WritingStudio({id}:{id:string}) {
  useScreenId('U13')
  const vm=useWritingViewModel(id)
  const bodyInput=useRef<HTMLTextAreaElement>(null)
  const [title,setTitle]=useState('')
  const [selection,setSelection]=useState({episode:0,id:''})
  const [rights,setRights]=useState(false)
  const active=vm.active
  const selected=active?.number===selection.episode?active.versions.find(v=>v.id===selection.id):undefined
  const status=vm.busy?'저장 중…':vm.error?(active?'저장 실패 · 입력을 확인해 주세요':'회차 불러오기 실패'):vm.dirty?'저장되지 않은 변경':active?.updatedAt?`저장됨 · ${new Date(active.updatedAt).toLocaleTimeString('ko-KR')}`:'회차를 선택해 주세요'
  return <div className="calm studio writing-studio">
    <header className="sbar">
      <a className="back" href="/content">내 작품</a><h1 className="t">집필실</h1>
      <span className="st" role="status" aria-live="polite">{status}</span>
      <button className="btn" disabled={vm.busy||!active||active.inherited} onClick={()=>void vm.save()}>버전 저장</button>
      <button className="btn" disabled={vm.busy} onClick={()=>void vm.reload()}>다시 불러오기</button>
    </header>
    {vm.error&&<div className="writing-message" role="alert">{vm.error} {active&&'저장되지 않은 원고는 복사해 보관한 뒤 다시 불러올 수 있어요.'}</div>}
    {vm.notice&&<p className="writing-message" role="status">{vm.notice}</p>}
    {!vm.ready?<p className="writing-message">회차를 불러오고 있어요…</p>:vm.error&&!active?null:<div className="writing-layout">
      <nav className="seps" aria-label="회차 목록">
        <h2 className="lab">회차</h2>
        {vm.episodes.map(e=><button className={`writing-episode ${active?.number===e.number?'on':''}`} key={e.number} aria-pressed={active?.number===e.number} disabled={vm.busy} onClick={()=>{if(!vm.select(e))return;setSelection({episode:0,id:''});setRights(false)}}>
          <strong>{e.number}화 · {e.draft.title}</strong><small>{e.inherited?'원작 기준 · 읽기 전용':e.publishedVersionId?'발행본 있음 · 초안 별도':'비공개 초안'}</small>
        </button>)}
        <form className="writing-create" onSubmit={async e=>{e.preventDefault();if(await vm.create(title)){setTitle('');setRights(false);setSelection({episode:0,id:''})}}}>
          <label className="field">새 회차 제목<input className="inp" value={title} maxLength={120} required disabled={vm.busy} onChange={e=>setTitle(e.target.value)}/></label>
          <button className="btn" disabled={vm.busy||!title.trim()}>회차 생성</button>
        </form>
      </nav>
      <main className="writing-editor">
        {active?<>
          <p className="muted">{active.number}화 · {active.inherited?'원작 기준 버전을 보존한 원고예요.':'입력을 멈추면 2초 후 초안만 저장해요. 버전 저장과 공개는 각각 선택하세요.'}</p>
          <label className="field">회차 제목<input className="inp" value={vm.draft.title} maxLength={120} readOnly={active.inherited||vm.editingLocked} onChange={e=>vm.edit({title:e.target.value})}/></label>
          <label className="field">원고 본문<textarea ref={bodyInput} className="inp writing-body" value={vm.draft.body} maxLength={40000} readOnly={active.inherited||vm.editingLocked} onChange={e=>vm.edit({body:e.target.value})}/></label>
          <p className="small muted">{vm.draft.body.length.toLocaleString('ko-KR')} / 40,000자</p>
          {!active.inherited&&<label className="media-file">본문 이미지 추가<input type="file" accept=".png,.jpg,.jpeg" disabled={vm.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void vm.addImage(file,bodyInput.current?.selectionStart??vm.draft.body.length,bodyInput.current?.selectionEnd??vm.draft.body.length)}}/></label>}
          <p className="small muted">PNG·JPEG · 파일당 10 MiB 이하 · 회차당 업로드 최대 10개. 커서 위치에 이미지 참조를 넣어요. 참조를 지우면 현재 원고에서만 빠지고 저장 버전은 유지돼요.</p>
          <button className="btn sm" disabled={vm.busy} onClick={vm.downloadText}>TXT 내보내기 · 텍스트 전용</button>
          {vm.busy&&<button className="btn sm" onClick={vm.cancel}>진행 중 요청 취소</button>}
          <details><summary>현재 원고 이미지 미리보기</summary><ManuscriptBody workId={id} number={active.number} body={vm.draft.body}/></details>
          <section aria-label="회차 관리">
            <button className="btn sm" disabled={vm.busy} onClick={()=>void vm.checkOrder()}>순서 변경 가능 범위 확인</button>
            <button className="btn sm" disabled={vm.busy||active.inherited||active.hasDraft===false} onClick={()=>void vm.deleteDraft()}>초안 삭제</button>
            <button className="btn sm" disabled={vm.busy||active.inherited} onClick={()=>void vm.deleteEpisode()}>회차 삭제</button>
            {active.hasDraft===false&&<p role="status">작업 초안이 없어요. 입력하면 새 초안으로 저장되며, 저장 버전은 아래에서 복원할 수 있어요.</p>}
          </section>
          <section aria-label="저장 버전과 발행" className="writing-history">
            <h2>저장 버전</h2>
            {!active.versions.length?<p>아직 저장한 버전이 없어요. 상단의 버전 저장을 눌러 원고를 남겨 주세요.</p>:<>
              <label className="field">검토할 저장 버전<select className="inp" value={selected?.id??''} onChange={e=>{setSelection({episode:active.number,id:e.target.value});setRights(false)}}>
                <option value="">버전 선택</option>{active.versions.map((v,i)=><option value={v.id} key={v.id}>버전 {i+1} · {v.title} · {new Date(v.savedAt).toLocaleString('ko-KR')}{active.publishedVersionId===v.id?' · 현재 발행본':''}</option>)}
              </select></label>
              {selected&&<><h3>{selected.title}</h3><div className="writing-preview"><ManuscriptBody workId={id} number={active.number} body={selected.body||'(빈 원고)'}/></div>
                <button className="btn" disabled={vm.busy||active.inherited} onClick={()=>void vm.restore(selected.id)}>선택 버전을 새 버전으로 복원</button>
                <label className="writing-rights"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> 이 저장 원고를 공개할 권리가 있음을 확인합니다.</label>
                <button className="btn pri" disabled={vm.busy||vm.dirty||!rights||active.inherited||!selected.body.trim()} onClick={async()=>{if(await vm.publish(selected.id,rights))setRights(false)}}>선택한 저장 버전 공개</button>
              </>}
            </>}
            <p className="small muted">원고와 허용된 설정을 버전 기준으로 보관해요. 인물·관계 저장소 동기화는 아직 지원하지 않아요.</p>
          </section>
        </>:<p>회차가 없어요. 첫 회차를 만들어 이야기를 시작해 보세요.</p>}
      </main>
    </div>}
  </div>
}
