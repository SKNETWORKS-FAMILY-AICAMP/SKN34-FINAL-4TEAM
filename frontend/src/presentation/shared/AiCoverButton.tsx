import { useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_COVER_REFERENCE, type ImageRequest } from '../../domain/repositories/ImageGenerationRepository'
import { inProgress, useImageGeneration } from './useImageGeneration'
type Props = { purpose?:Extract<ImageRequest['purpose'],'work_cover'|'world_cover'>; workId?:string; worldId?:string; hasCurrentCover?:boolean; disabled?:boolean; saveHint?:string; onPick?:(file:File)=>void }
/** 생성 결과는 명시적으로 선택한 뒤 기존 표지 저장 흐름에 전달한다. saveHint는 선택 뒤 저장이 어떻게 이뤄지는지 호출 화면이 알린다. */
export function AiCoverButton({purpose='work_cover',workId,worldId,hasCurrentCover=false,onPick,disabled=false,saveHint='이미지를 선택한 뒤 표지를 저장해 주세요.'}:Props) {
 const [open,setOpen]=useState(false)
 const panelId=useId()
 const trigger=useRef<HTMLButtonElement>(null)
 const pickButton=useRef<HTMLButtonElement>(null)
 const vm=useImageGeneration({purpose,workId,worldId})
 const {referenceMode,setReferenceMode,preview}=vm
 const running=vm.job && inProgress(vm.job.status)
 const locked=disabled || vm.busy || !!running || vm.loadingPreview
 const canRetryStatus=vm.unresolved || running || vm.job?.status==='succeeded'
 const referenceReady=referenceMode==='preset' || (referenceMode==='cover' && hasCurrentCover)
  || (referenceMode==='upload' && !!vm.referenceFile && !vm.referenceIssue)
 // 현재 표지가 사라졌는데 '현재 표지' 참고가 남으면 입력이 사라져 생성이 잠기므로 내 이미지 올리기로 돌아간다.
 useEffect(()=>{ if(!hasCurrentCover && referenceMode==='cover') setReferenceMode('upload') },[hasCurrentCover,referenceMode,setReferenceMode])
 // 미리보기가 생기면 선택 버튼으로 초점을 옮긴다. 초점이 이 패널 밖(작성 중인 다른 입력 칸)에 있으면 빼앗지 않는다.
 useEffect(()=>{
  if(preview && (document.activeElement===document.body || document.getElementById(panelId)?.contains(document.activeElement))) pickButton.current?.focus()
 },[preview,panelId])
 function statusText() {
  if(vm.error) return ''
  if(running) return vm.job?.stage==='uploading' ? '이미지를 저장하는 중이에요.' : '이미지를 생성하는 중이에요. 화면을 닫아도 계속돼요.'
  if(vm.busy) return '요청 상태를 확인하는 중이에요.'
  if(vm.loadingPreview) return '미리보기를 불러오는 중이에요.'
  return preview ? '이미지가 준비됐어요. 미리보기를 확인해 주세요.' : ''
 }
 function pickResult() {
  const file=vm.file()
  if(!file) return
  onPick?.(file)
  vm.clear()
  setOpen(false)
  trigger.current?.focus()
 }
 return <div className='ep-cover-ai' data-open={open || undefined}>
  <button ref={trigger} type='button' className='btn sm' aria-expanded={open} aria-controls={open ? panelId : undefined}
    disabled={disabled || !onPick || import.meta.env.MODE==='mockup'} onClick={()=>setOpen(value=>!value)}>AI로 생성</button>
  {open && <div id={panelId} className='ep-cover-ai-panel' role='group' aria-label='AI 이미지 생성'>
   <label>참고 이미지
    <select className='inp' value={referenceMode} disabled={locked}
      onChange={e=>setReferenceMode(e.target.value==='cover'?'cover':e.target.value==='upload'?'upload':'preset')}>
     <option value='preset'>기본 이미지</option>
     {hasCurrentCover && <option value='cover'>현재 표지</option>}
     <option value='upload'>내 이미지 올리기</option>
    </select>
   </label>
   {referenceMode==='preset' ? <span className='ep-cover-ai-preset'>
    <img src={`/api/v1/public/cover-references/${DEFAULT_COVER_REFERENCE}`} alt='기본 참고 이미지: 해 질 녘 산길' width={72} height={96} />
    <span className='small muted'>해 질 녘 산길 · 그림체와 색감 참고</span>
   </span> : <>
    {referenceMode==='upload' && <>
     <label className='btn sm ep-file-pick'>참고 이미지 올리기
      <input type='file' accept='.png,.jpg,.jpeg,.webp' disabled={locked} onChange={e=>vm.setReferenceFile(e.target.files?.[0])} />
     </label>
     <p className='small muted'>{vm.referenceFile ? `선택한 파일: ${vm.referenceFile.name}` : 'PNG·JPEG·WebP, 5 MiB 이하.'}</p>
     {vm.referencePreview && <img className='ep-cover-ai-reference' src={vm.referencePreview} alt='선택한 참고 이미지' />}
     {vm.referenceIssue && <p className='ep-alert' role='alert'>{vm.referenceIssue}</p>}
    </>}
    <label>참고 목적
     <select className='inp' value={vm.referenceRole} disabled={locked} onChange={e=>vm.setReferenceRole(e.target.value==='subject'?'subject':'style')}>
      <option value='style'>그림체·색감</option>
      <option value='subject'>인물·장소 외형</option>
     </select>
    </label>
    <p className='small muted'>생성 요청 시 참고 이미지를 OpenAI에 전달해요. 사용할 권한이 있는 이미지를 선택해 주세요.</p>
   </>}
   <label>고정 시각 설정 (선택)
    <textarea className='inp' rows={2} value={vm.visualSettings} onChange={e=>vm.setVisualSettings(e.target.value)} maxLength={6000}
      disabled={locked} placeholder='유지할 그림체, 색감, 인물 외형' />
   </label>
   <label>이번 장면
    <textarea className='inp' rows={3} value={vm.prompt} onChange={e=>vm.setPrompt(e.target.value)} maxLength={12000}
      disabled={locked} placeholder='장소, 행동, 시간대, 분위기' />
   </label>
   <button type='button' className='btn pri sm' disabled={locked || !vm.prompt.trim() || !referenceReady} onClick={()=>void vm.generate()}>생성 요청</button>
   <p className='small muted' role='status'>{statusText()}</p>
   {vm.error && <div className='ep-cover-ai-feedback'>
    <p className='ep-alert' role='alert'>{vm.error}</p>
    {canRetryStatus && <button type='button' className='btn sm' onClick={vm.retry}>상태 다시 확인</button>}
   </div>}
   {preview && <div className='ep-cover-ai-result'>
    <img src={preview} alt='생성 이미지 미리보기' width={144} height={192} />
    <button ref={pickButton} type='button' className='btn sm' disabled={disabled} onClick={pickResult}>이 이미지 선택</button>
    <p className='small muted'>{saveHint}</p>
   </div>}
  </div>}
 </div>
}
