import {useEffect} from 'react'
import type {MediaTarget} from '../../../domain/entities/media'
import {imageReferencePattern} from '../../../domain/entities/media'
import {useMediaViewModel,useStoredImage} from './useMediaViewModel'
import './media.css'

export function StoredImage({target,id,alt,publicView=false,revision=0}:{target:MediaTarget;id:string;alt:string;publicView?:boolean;revision?:number}) {
 const vm=useStoredImage(target,id,publicView,revision)
 return vm.url?<img className="stored-image" src={vm.url} alt={alt}/>:<p className="media-message" role={vm.error?'alert':'status'}>{vm.error||'이미지를 불러오고 있어요…'}</p>
}

export function ManuscriptBody({workId,number,body,publicView=false}:{workId:string;number:number;body:string;publicView?:boolean}) {
 const parts=[];let offset=0;let imageNumber=0
 for(const match of body.matchAll(imageReferencePattern)){
  parts.push(<span key={`text-${offset}`}>{body.slice(offset,match.index)}</span>)
  parts.push(<StoredImage key={`${match.index}-${match[1]}`} target={{kind:'episode',workId,number}} id={match[1]} alt={`본문 이미지 ${++imageNumber}`} publicView={publicView}/>)
  offset=match.index+match[0].length
 }
 parts.push(<span key={`text-${offset}`}>{body.slice(offset)}</span>)
 return <div className="manuscript-body">{parts}</div>
}

export function MediaPanel({target,onBusy,disabled=false}:{target:MediaTarget;onBusy?:(value:boolean)=>void;disabled?:boolean}) {
 const vm=useMediaViewModel(target)
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
     <button type="button" className="btn sm" onClick={()=>{if(window.confirm(`${item.filename} 첨부를 삭제할까요?`))void vm.remove(item.id)}}>삭제 · {item.filename}</button></div>
   </li>)}</ul>
  </fieldset>
  {vm.busy&&<button className="btn sm" type="button" onClick={vm.cancel}>파일 요청 취소</button>}
 </section>
}
