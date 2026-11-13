import {Fragment,useEffect,useMemo,useRef,useState} from 'react'
import type {Attachment,MediaTarget} from '../../../domain/entities/media'
import {manuscriptBlocks,type InlinePart} from '../../../domain/entities/manuscriptFormat'
import {useMediaViewModel,useStoredImage} from './useMediaViewModel'
import {usePublicImageAlts} from './usePublicImageAlts'
import './media.css'

/**
 * 저장된 이미지 한 장. 자리표시가 화면 가까이 올 때까지 내려받지 않는다: 닫힌 접힘(details) 안이나 긴 원고 아래쪽의 이미지를 열기도 전에 받지 않는다.
 * 화면 위치를 지켜볼 수 없는 환경(IntersectionObserver 없음)에서는 바로 받는다.
 */
export function StoredImage({target,id,alt,publicView=false,revision=0}:{target:MediaTarget;id:string;alt:string;publicView?:boolean;revision?:number}) {
 const [near,setNear]=useState(()=>typeof IntersectionObserver!=='function')
 const placeholder=useRef<HTMLParagraphElement>(null)
 useEffect(()=>{
  if(near||!placeholder.current)return
  const watch=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))setNear(true)},{rootMargin:'300px'})
  watch.observe(placeholder.current)
  return ()=>watch.disconnect()
 },[near])
 const vm=useStoredImage(target,id,publicView,revision,undefined,near)
 return vm.url?<img className="stored-image" src={vm.url} alt={alt}/>:<p ref={placeholder} className="media-message" role={vm.error?'alert':'status'}>{vm.error||'이미지를 불러오고 있어요…'}</p>
}

/** 원고의 줄 안 서식 조각을 굵게(strong)·기울임(em)으로 그린다. 글자는 React가 이스케이프하므로 원고에 적힌 태그는 글자로만 보인다. */
export function ManuscriptText({parts}:{parts:Pick<InlinePart,'text'|'bold'|'italic'>[]}) {
 return parts.map((part,i)=>{
  const text=part.italic?<em>{part.text}</em>:part.text
  return <Fragment key={i}>{part.bold?<strong>{text}</strong>:text}</Fragment>
 })
}

/**
 * 원고 본문을 원고 기본 서식(DEC-48)대로 그린다: 문단(문단 안의 줄바꿈은 줄바꿈으로)·소제목·인용·구분선·이미지·빈 줄.
 * 서식 없는 원고는 통째로 글자로 그리던 때와 같은 줄 배치다: 빈 줄은 그 수만큼의 빈 줄이고, 본문을 끝내는 마지막 줄바꿈은 빈 줄을 만들지 않는다.
 * 소제목은 쓰는 화면(저장 버전 보기·버전 비교·체크포인트·작품 관리)마다 바깥 제목 단계가 달라 제목 요소가 아닌 굵은 문단으로 그린다.
 */
export function ManuscriptBody({workId,number,body,publicView=false}:{workId:string;number:number;body:string;publicView?:boolean}) {
 const blocks=useMemo(()=>manuscriptBlocks(body),[body])
 const alts=usePublicImageAlts(workId,number,publicView&&blocks.some(block=>block.kind==='image'))
 let imageNumber=0
 return <div className="manuscript-body">{blocks.map((block,index)=>{
  if(block.kind==='blank')return Array.from({length:block.count-(index===blocks.length-1?1:0)},(_,i)=><br key={`${index}-${i}`}/>)
  if(block.kind==='rule')return <hr key={index}/>
  if(block.kind==='image'){
   // 글을 고쳐 블록 순서가 밀려도 같은 이미지를 다시 받지 않도록 이미지와 그 순번으로 식별한다.
   const fallback=`본문 이미지 ${++imageNumber}`
   return <StoredImage key={`${block.id}/${imageNumber}`} target={{kind:'episode',workId,number}} id={block.id} alt={alts[block.id]||fallback} publicView={publicView}/>
  }
  const lines=block.lines.map((parts,i)=><Fragment key={i}>{i>0&&'\n'}<ManuscriptText parts={parts}/></Fragment>)
  return block.kind==='quote'?<blockquote key={index}>{lines}</blockquote>:<p key={index} className={block.kind==='heading'?'manuscript-heading':undefined}>{lines}</p>
 })}</div>
}

/** 설정 첨부 이름 변경: 확장자는 서버가 형식을 정하므로 고정해서 보이고, 실패하면 입력을 그대로 둔다. */
function RenameForm({item,onRename,onCancel}:{item:Attachment;onRename:(filename:string)=>Promise<boolean>;onCancel:()=>void}) {
 const dot=item.filename.lastIndexOf('.'),ext=dot>0?item.filename.slice(dot):''
 const [name,setName]=useState(dot>0?item.filename.slice(0,dot):item.filename)
 return <form className="media-rename" onSubmit={async e=>{e.preventDefault();if(await onRename(name+ext))onCancel()}}>
  <span className="media-rename-row"><input className="inp" aria-label={`새 파일 이름 · ${item.filename}`} value={name} maxLength={120-ext.length} onChange={e=>setName(e.target.value)}/><span>{ext}</span></span>
  <p className="small muted">확장자({ext})는 바꿀 수 없어요.</p>
  <button type="submit" className="btn sm">이름 저장</button> <button type="button" className="btn sm" onClick={onCancel}>취소</button>
 </form>
}

export function MediaPanel({target,onBusy,disabled=false}:{target:MediaTarget;onBusy?:(value:boolean)=>void;disabled?:boolean}) {
 const vm=useMediaViewModel(target)
 const [renaming,setRenaming]=useState('')
 const cover=target.kind==='cover'
 useEffect(()=>{onBusy?.(vm.mutating);return ()=>onBusy?.(false)},[vm.mutating,onBusy])
 return <section className={`media-panel ${cover?'media-cover':''}`} aria-label={cover?'작품 표지':'설정 첨부'}>
  <h3>{cover?'작품 표지':'이미지·파일 첨부'}</h3>
  <p className="small muted">{cover?'PNG·JPEG, 10 MiB 이하. 작품 공개 전에는 나만 볼 수 있어요.':'PNG·JPEG·TXT·MD·CSV·PDF, 파일당 10 MiB 이하 · 설정 이미지 최대 10개. 첨부는 소유자 전용이며 독자에게 자동 공개되지 않아요.'}</p>
  {vm.error&&<p role="alert">{vm.error}</p>}
  <p role="status">{vm.busy?'파일을 처리하고 있어요…':vm.notice||(!vm.items.length?'저장된 파일이 없어요.':'')}</p>
  {cover&&!vm.busy&&!vm.error&&vm.items.length===0&&<img className="stored-image" src="/default-work-cover.svg" alt="기본 작품 표지" width="180" height="240"/>}
  <fieldset disabled={vm.busy||disabled}>
   <legend className="sr-only">{cover?'표지 관리':'첨부 관리'}</legend>
   <label className="media-file">{cover?'표지 선택·변경':'설정 첨부 파일'}<input type="file" accept={cover?'.png,.jpg,.jpeg':'.png,.jpg,.jpeg,.txt,.md,.csv,.pdf'} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void vm.upload(file)}}/></label>
   <button className="btn sm" type="button" onClick={()=>void vm.reload()}>첨부 새로고침</button>
   <ul className="media-list">{vm.items.map(item=><li key={item.id}>
    {item.kind==='IMAGE'&&<StoredImage target={target} id={item.id} alt={cover?'작품 표지':item.filename} revision={vm.revision}/>}
    <p><strong>{item.filename}</strong> · {(item.byteSize/1024).toLocaleString('ko-KR',{maximumFractionDigits:1})} KiB</p>
    <div className="media-actions"><button type="button" className="btn sm" onClick={()=>void vm.download(item)}>다운로드 · {item.filename}</button>
     {!cover&&<label className="media-file">파일 교체 · {item.filename}<input type="file" aria-label={`파일 교체 · ${item.filename}`} accept=".png,.jpg,.jpeg,.txt,.md,.csv,.pdf" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void vm.upload(file,item.id)}}/></label>}
     {target.kind==='setting'&&renaming!==item.id&&<button type="button" className="btn sm" onClick={()=>setRenaming(item.id)}>이름 변경 · {item.filename}</button>}
     <button type="button" className="btn sm" onClick={()=>{if(window.confirm(`${item.filename} 첨부를 삭제할까요?`))void vm.remove(item.id)}}>삭제 · {item.filename}</button></div>
    {target.kind==='setting'&&renaming===item.id&&<RenameForm item={item} onRename={filename=>vm.rename(item,filename)} onCancel={()=>setRenaming('')}/>}
   </li>)}</ul>
  </fieldset>
  {vm.busy&&<button className="btn sm" type="button" onClick={vm.cancel}>파일 요청 취소</button>}
 </section>
}
