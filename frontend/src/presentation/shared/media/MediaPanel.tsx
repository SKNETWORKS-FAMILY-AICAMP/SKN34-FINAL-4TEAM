import {useEffect,useState} from 'react'
import type {Attachment,MediaTarget} from '../../../domain/entities/media'
import {imageReferencePattern} from '../../../domain/entities/media'
import {useMediaViewModel,useStoredImage} from './useMediaViewModel'
import {usePublicImageAlts} from './usePublicImageAlts'
import './media.css'

export function StoredImage({target,id,alt,publicView=false,revision=0}:{target:MediaTarget;id:string;alt:string;publicView?:boolean;revision?:number}) {
 const vm=useStoredImage(target,id,publicView,revision)
 return vm.url?<img className="stored-image" src={vm.url} alt={alt}/>:<p className="media-message" role={vm.error?'alert':'status'}>{vm.error||'이미지를 불러오고 있어요…'}</p>
}

export function ManuscriptBody({workId,number,body,publicView=false}:{workId:string;number:number;body:string;publicView?:boolean}) {
 const alts=usePublicImageAlts(workId,number,publicView&&body.includes('[[image:'))
 const parts=[];let offset=0;let imageNumber=0
 for(const match of body.matchAll(imageReferencePattern)){
  parts.push(<span key={`text-${offset}`}>{body.slice(offset,match.index)}</span>)
  const fallback=`본문 이미지 ${++imageNumber}`
  parts.push(<StoredImage key={`${match.index}-${match[1]}`} target={{kind:'episode',workId,number}} id={match[1]} alt={alts[match[1]]||fallback} publicView={publicView}/>)
  offset=match.index+match[0].length
 }
 parts.push(<span key={`text-${offset}`}>{body.slice(offset)}</span>)
 return <div className="manuscript-body">{parts}</div>
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
