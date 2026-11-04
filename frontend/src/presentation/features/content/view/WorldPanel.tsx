import {useEffect,useState} from 'react'
import type {EpisodeUseCase} from '../../../../domain/usecases/EpisodeUseCase'
import {settingCategories} from '../../../../domain/entities/content'
import {useWorldViewModel} from '../viewmodel/useWorldViewModel'
import {MediaPanel} from '../../../shared/media/MediaPanel'

export function WorldPanel({workId,useCase,onDirty}:{workId:string;useCase?:EpisodeUseCase;onDirty:(dirty:boolean)=>void}) {
 const vm=useWorldViewModel(workId,useCase)
 const [attachmentBusy,setAttachmentBusy]=useState(false)
 const locked=vm.busy||attachmentBusy
 useEffect(()=>onDirty(vm.dirty||locked),[vm.dirty,locked,onDirty])
 const w=vm.world
 if(!w)return <section className="ep-world"><p role={vm.error?'alert':'status'}>{vm.error||'설정집을 불러오고 있어요…'}</p><button className="btn sm" onClick={vm.reload}>설정집 다시 불러오기</button></section>
 return <section className="ep-world" aria-label="세계관 설정집">
  <header><h2>{w.name}</h2><p>{w.mode==='following'?'원작 추종 중 · 첫 설정 수정 시 전체 공개 설정이 독립해요.':w.mode==='independent'?'독립 세계관 · 원작 변경은 선택해서 반영해요.':'내 작품의 세계관 · 확정 설정만 문맥에 사용해요.'}</p>
   {w.basis&&<p>최초 분기 기준: {w.basis.episode}화 · 원고 버전 {w.basis.version} · 설정 {w.basis.settings.length}개</p>}
   <button className="btn sm" disabled={locked||vm.dirty} onClick={vm.reload}>설정집 새로고침</button></header>
  {vm.error&&<p className="ep-alert" role="alert">{vm.error} <button className="btn sm" disabled={locked} onClick={vm.reload}>최신 설정집 불러오기</button></p>}
  <p role="status">{vm.busy?'설정집을 저장하고 있어요…':vm.notice|| (vm.dirty?'설정 초안 자동저장 대기':'')}</p>
  {w.changes.length>0&&<section className="ep-world-changes" aria-label="원작 설정 변경"><h3>원작의 변경 사항</h3>{w.changes.map(c=><article key={c.id}><h4>{c.after?.name??c.before?.name} · {c.decision==='pending'?'확인 필요':c.decision==='apply'?'반영함':'보류함'}</h4><p>{c.after?.content??'기준 회차의 공개 범위에서 제외됐어요.'}</p><p>현재 분기 설정을 이 내용으로 대체하는 선택입니다. 이전 버전은 보존돼요.</p><button className="btn sm" disabled={locked||vm.dirty||c.decision==='apply'} onClick={()=>vm.decide(c.id,'apply')}>이 원본 변경 반영</button><button className="btn sm" disabled={locked||vm.dirty||c.decision!=='pending'} onClick={()=>vm.decide(c.id,'reject')}>변경 보류</button></article>)}</section>}
  <div className="ep-world-columns"><section aria-label="설정 항목 목록"><h3>설정 항목 <span>{w.settings.length}</span></h3><button className="btn sm" disabled={locked} onClick={vm.newSetting}>새 설정 항목</button>
   {!w.settings.length&&<p>세계의 규칙이나 인물을 기록해 보세요. 새 항목은 비공개로 시작해요.</p>}
   {w.settings.map(s=><button className="ep-setting-row" key={s.id} aria-pressed={vm.sid===s.id} disabled={locked} onClick={()=>vm.pick(s)}><strong>{s.name}</strong><span>{s.category} · {s.visibility==='public'?'공개':'비공개'} · {s.fromEpisode}화{ s.toEpisode?`~${s.toEpisode}화`:'부터'}</span></button>)}
   {w.drafts.map(d=><button key={d.id} className="btn sm" disabled={locked} onClick={()=>vm.pick(d)}>초안 열기 · {d.name}</button>)}
  </section>
  <form onSubmit={e=>{e.preventDefault();vm.commit()}}><fieldset disabled={vm.editingLocked}><legend>{vm.sid==='new'?'새 설정 작성':'설정 편집'}</legend>
   <label>설정 이름<input value={vm.form.name} maxLength={120} required onChange={e=>vm.edit({name:e.target.value})}/></label>
   <label>카테고리<select value={vm.form.category} onChange={e=>{const category=settingCategories.find(c=>c===e.target.value);if(category)vm.edit({category})}}>{settingCategories.map(c=><option key={c}>{c}</option>)}</select></label>
   <label>설정 내용<textarea value={vm.form.content} maxLength={8000} rows={7} required onChange={e=>vm.edit({content:e.target.value})}/></label>
   <label>근거 회차·출처<input value={vm.form.evidence} maxLength={1000} onChange={e=>vm.edit({evidence:e.target.value})}/></label>
   <label>태그 (쉼표로 구분)<input value={vm.form.tags.join(',')} onChange={e=>vm.edit({tags:e.target.value ? e.target.value.split(',') : []})}/></label>
   <div className="ep-world-range"><label>적용 시작 회차<input type="number" min={1} value={vm.form.fromEpisode} onChange={e=>vm.edit({fromEpisode:Number(e.target.value)})}/></label><label>적용 종료 회차 (선택)<input type="number" min={vm.form.fromEpisode} value={vm.form.toEpisode??''} onChange={e=>vm.edit({toEpisode:e.target.value?Number(e.target.value):null})}/></label></div>
   <label>독자 공개 범위<select value={vm.form.visibility} onChange={e=>vm.edit({visibility:e.target.value==='public'?'public':'private'})}><option value="private">비공개 · 내 집필 문맥만</option><option value="public">지정 회차 범위에 공개</option></select></label>
   <label>이 정보를 아는 인물 (쉼표로 구분)<input value={vm.form.knownBy.join(',')} placeholder="에리히,한트베커 · 모두 아는 정보는 *" onChange={e=>vm.edit({knownBy:e.target.value ? e.target.value.split(',') : []})}/></label>
   <p>빈칸이면 인물 시점에서는 제외돼요. 인물 상태·지식·관계도 별도 항목으로 기록하세요. 공개와 인물의 지식은 다른 기준이에요.</p>
   <button type="button" className="btn sm" disabled={locked||!vm.dirty} onClick={()=>void vm.saveDraft()}>설정 초안 저장</button>
   <button className="btn pri" disabled={locked||vm.dirty||!w.drafts.some(d=>d.id===vm.sid)}>설정 확정 저장</button>
  </fieldset></form></div>
  {vm.sid==='new'?<p>설정 초안을 서버에 저장하면 이미지·파일을 첨부할 수 있어요.</p>:w.mode==='following'?<p>원작 추종 설정에는 첨부할 수 없어요. 내 설정을 수정·저장하여 독립한 뒤 이용해 주세요.</p>:<MediaPanel key={`${workId}-${vm.sid}`} target={{kind:'setting',workId,settingId:vm.sid}} onBusy={setAttachmentBusy} disabled={vm.busy}/>}
  <details className="ep-world-history"><summary>설정 버전 이력 · {w.history.length}개</summary>{w.history.filter(s=>s.content).map(s=><article key={s.versionId}><h3>{s.name} · {s.fromEpisode}화부터 · {s.visibility==='public'?'공개':'비공개'}</h3><p>{s.content}</p><small>{s.evidence}</small><button className="btn sm" disabled={locked||vm.dirty||!!w.draft} onClick={()=>vm.revert(s.id,s.versionId)}>이 설정을 새 버전으로 복원</button></article>)}</details>
 </section>
}
