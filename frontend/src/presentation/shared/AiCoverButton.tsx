import { useId, useRef, useState } from 'react'
import { DEFAULT_COVER_REFERENCE, type ImageRequest } from '../../domain/repositories/ImageGenerationRepository'
import { useImageGeneration } from './useImageGeneration'
type Props = { purpose?:Extract<ImageRequest['purpose'],'work_cover'|'world_cover'>; workId?:string; worldId?:string; hasCurrentCover?:boolean; disabled?:boolean; onPick?:(file:File)=>void }
/** 생성 결과는 명시적으로 선택한 뒤 기존 표지 저장 흐름에 전달한다. */
export function AiCoverButton({purpose='work_cover',workId,worldId,hasCurrentCover=false,onPick,disabled=false}:Props) {
 const [open,setOpen]=useState(false)
 const panelId=useId()
 const trigger=useRef<HTMLButtonElement>(null)
 const vm=useImageGeneration({purpose,workId,worldId})
 const running=vm.job && ['accepted','queued','running'].includes(vm.job.status)
 const locked=disabled || vm.busy || !!running
 const canRetryStatus=vm.unresolved || running || vm.job?.status==='succeeded'
 const referenceReady=vm.referenceMode==='preset' || (vm.referenceMode==='cover' && hasCurrentCover)
  || (vm.referenceMode==='upload' && !!vm.referenceFile && !vm.referenceIssue)
 function pickResult() {
  const file=vm.file()
  if(!file) return
  onPick?.(file)
  setOpen(false)
  trigger.current?.focus()
 }
 return <div className='ep-cover-ai' data-open={open || undefined}>
  <button ref={trigger} type='button' className='btn sm' aria-expanded={open} aria-controls={open ? panelId : undefined}
    disabled={disabled || !onPick || import.meta.env.MODE==='mockup'} onClick={()=>setOpen(value=>!value)}>AI로 생성</button>
  {open && <div id={panelId} className='ep-cover-ai-panel' role='group' aria-label='AI 이미지 생성'>
   <label>참고 이미지
    <select className='inp' value={vm.referenceMode==='preset'?'preset':'custom'} disabled={locked}
      onChange={e=>vm.setReferenceMode(e.target.value==='preset'?'preset':hasCurrentCover?'cover':'upload')}>
     <option value='preset'>기본 이미지 참고</option>
     <option value='custom'>내 이미지 참고</option>
    </select>
   </label>
   {vm.referenceMode==='preset' ? <span className='ep-cover-ai-preset'>
    <img src={`/api/v1/public/cover-references/${DEFAULT_COVER_REFERENCE}`} alt='기본 참고 이미지: 해 질 녘 산길' width={72} height={96} />
    <span className='small muted'>해 질 녘 산길 · 그림체와 색감 참고</span>
   </span> : <>
    {hasCurrentCover && <label>이미지 출처
     <select className='inp' value={vm.referenceMode} disabled={locked}
       onChange={e=>vm.setReferenceMode(e.target.value==='cover'?'cover':'upload')}>
      <option value='cover'>현재 표지</option>
      <option value='upload'>새 이미지 업로드</option>
     </select>
    </label>}
    {vm.referenceMode==='upload' && <>
     <label>참고 파일 (PNG·JPEG·WebP, 5 MiB 이하)
      <input className='inp' type='file' accept='.png,.jpg,.jpeg,.webp' disabled={locked} onChange={e=>vm.setReferenceFile(e.target.files?.[0])} />
     </label>
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
   {!vm.error && (running || vm.busy) && <p className='small muted' role='status'>
    {running
      ? (vm.job?.stage==='uploading' ? '이미지를 저장하는 중이에요.' : '이미지를 생성하는 중이에요. 화면을 닫아도 계속돼요.')
      : '요청 상태를 확인하는 중이에요.'}
   </p>}
   {vm.error && <div className='ep-cover-ai-feedback'>
    <p className='ep-alert' role='alert'>{vm.error}</p>
    {canRetryStatus && <button type='button' className='btn sm' onClick={vm.retry}>상태 다시 확인</button>}
   </div>}
   {vm.preview && <div className='ep-cover-ai-result'>
    <img src={vm.preview} alt='생성 이미지 미리보기' width={144} height={192} />
    <button type='button' className='btn sm' disabled={disabled} onClick={pickResult}>이 이미지 선택</button>
    <p className='small muted'>이미지를 선택한 뒤 표지를 저장해 주세요.</p>
   </div>}
  </div>}
 </div>
}
