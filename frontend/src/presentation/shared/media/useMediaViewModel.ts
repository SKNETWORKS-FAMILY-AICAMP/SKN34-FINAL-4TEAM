import {useEffect,useEffectEvent,useRef,useState} from 'react'
import {appContainer} from '../../../app/appContainer'
import type {Attachment,MediaTarget} from '../../../domain/entities/media'
import type {MediaUseCase} from '../../../domain/usecases/MediaUseCase'

type MediaApi=Pick<MediaUseCase,'list'|'upload'|'remove'|'download'>
export function useMediaViewModel(target:MediaTarget,api:MediaApi=appContainer.resolve('mediaUseCase')) {
 const [items,setItems]=useState<Attachment[]>([])
 const [busy,setBusy]=useState(true)
 const [mutating,setMutating]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [revision,setRevision]=useState(0)
 const pending=useRef<AbortController|null>(null)
 const downloads=useRef(new Map<string,ReturnType<typeof setTimeout>>())
 const key=JSON.stringify(target)
 const load=useEffectEvent((signal:AbortSignal)=>api.list(target,signal))
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;setBusy(true);setItems([]);setError('')
  load(controller.signal).then(rows=>{if(!controller.signal.aborted)setItems(rows)}).catch((e:unknown)=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'첨부 목록을 불러오지 못했어요.')}).finally(()=>{if(!controller.signal.aborted){pending.current=null;setBusy(false)}})
  const urls=downloads.current
  return ()=>{controller.abort();pending.current?.abort();for(const [url,timer] of urls){clearTimeout(timer);URL.revokeObjectURL(url)}urls.clear()}
 },[key,api])
 const run=async(action:(signal:AbortSignal)=>Promise<void>)=>{
  if(pending.current)return false
  const controller=new AbortController();pending.current=controller;setBusy(true);setMutating(true);setError('');setNotice('')
  try{await action(controller.signal);return !controller.signal.aborted}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'파일 처리에 실패했어요. 기존 파일은 화면에 남아 있어요.');return false}
  finally{if(pending.current===controller){pending.current=null;if(!controller.signal.aborted){setBusy(false);setMutating(false)}}}
 }
 return {items,busy,mutating,error,notice,revision,
  reload:()=>run(async signal=>{const rows=await api.list(target,signal);if(!signal.aborted){setItems(rows);setRevision(v=>v+1);setNotice('서버의 첨부 목록을 확인했어요.')}}),
  upload:(file:File,replaceId?:string)=>run(async signal=>{const item=await api.upload(target,file,replaceId,signal);if(!signal.aborted){setItems(rows=>target.kind==='cover'?[item]:[...rows.filter(x=>x.id!==item.id),item]);setRevision(v=>v+1);setNotice('파일을 서버에 저장했어요.')}}),
  remove:(id:string)=>run(async signal=>{await api.remove(target,id,signal);if(!signal.aborted){setItems(rows=>rows.filter(x=>x.id!==id));setNotice('첨부를 삭제했어요.')}}),
  download:(item:Attachment)=>run(async signal=>{const blob=await api.download(target,item.id,false,signal);if(signal.aborted)return;const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=item.filename;link.click();downloads.current.set(url,setTimeout(()=>{URL.revokeObjectURL(url);downloads.current.delete(url)},1000));setNotice('파일 다운로드를 요청했어요.')}),
  cancel:()=>{pending.current?.abort();pending.current=null;setBusy(false);setMutating(false);setError('전송을 취소했어요. 서버에서 이미 처리했을 수 있으므로 첨부 새로고침으로 확인해 주세요.')},
 }
}

export function useStoredImage(target:MediaTarget,id:string,publicView=false,revision=0,api:Pick<MediaUseCase,'download'>=appContainer.resolve('mediaUseCase')) {
 const [state,setState]=useState({url:'',error:''})
 const key=JSON.stringify(target)
 const load=useEffectEvent((signal:AbortSignal)=>api.download(target,id,publicView,signal))
 useEffect(()=>{
  const controller=new AbortController();let url='';setState({url:'',error:''})
  load(controller.signal).then(blob=>{
   if(controller.signal.aborted)return
   if(!['image/png','image/jpeg'].includes(blob.type))throw new Error('안전한 이미지 응답을 확인할 수 없어요.')
   url=URL.createObjectURL(blob);setState({url,error:''})
  }).catch((e:unknown)=>{if(!controller.signal.aborted)setState({url:'',error:e instanceof Error?e.message:'이미지를 불러오지 못했어요.'})})
  return ()=>{controller.abort();if(url)URL.revokeObjectURL(url)}
 },[key,id,publicView,revision,api])
 return state
}
