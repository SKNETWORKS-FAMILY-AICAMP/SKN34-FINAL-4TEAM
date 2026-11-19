import { useState } from 'react'
import { DEFAULT_COVER_REFERENCE, type ImageRequest } from '../../domain/repositories/ImageGenerationRepository'
import { useImageGeneration } from './useImageGeneration'
type Props = { purpose?:Extract<ImageRequest['purpose'],'work_cover'|'world_cover'>; workId?:string; worldId?:string; hasCurrentCover?:boolean; disabled?:boolean; onPick?:(file:File)=>void }
/** 생성 결과는 명시적으로 선택한 뒤 기존 표지 저장 흐름에 전달한다. */
export function AiCoverButton({purpose='work_cover',workId,worldId,hasCurrentCover=false,onPick,disabled=false}:Props) {
 const [open,setOpen]=useState(false)
 const vm=useImageGeneration({purpose,workId,worldId})
 const running=vm.job && ['accepted','queued','running'].includes(vm.job.status)
 const locked=disabled || vm.busy || !!running
 const referenceReady=vm.referenceMode==='preset' || (vm.referenceMode==='cover' && hasCurrentCover)
  || (vm.referenceMode==='upload' && !!vm.referenceFile && !vm.referenceIssue)
 return <span className='ep-cover-ai'>
  <button type='button' className='btn sm' disabled={disabled || !onPick || import.meta.env.MODE==='mockup'} onClick={()=>setOpen(!open)}><span aria-hidden='true'>✦</span> AI로 생성</button>
  {open && <span className='ep-cover-ai-panel' role='group' aria-label='AI 이미지 생성'>
   <label>참고 이미지
    <select value={vm.referenceMode==='preset'?'preset':'custom'} disabled={locked}
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
     <select value={vm.referenceMode} disabled={locked}
       onChange={e=>vm.setReferenceMode(e.target.value==='cover'?'cover':'upload')}>
      <option value='cover'>현재 표지</option>
      <option value='upload'>새 이미지 업로드</option>
     </select>
    </label>}
    {vm.referenceMode==='upload' && <>
     <label>참고 파일 (PNG·JPEG·WebP, 5 MiB 이하)
      <input type='file' accept='.png,.jpg,.jpeg,.webp' disabled={locked} onChange={e=>vm.setReferenceFile(e.target.files?.[0])} />
     </label>
     {vm.referencePreview && <img src={vm.referencePreview} alt='선택한 참고 이미지' style={{maxWidth:96,maxHeight:128,objectFit:'contain'}} />}
     {vm.referenceIssue && <span role='alert'>{vm.referenceIssue}</span>}
    </>}
    <label>참고 목적
     <select value={vm.referenceRole} disabled={locked} onChange={e=>vm.setReferenceRole(e.target.value==='subject'?'subject':'style')}>
      <option value='style'>그림체·색감</option>
      <option value='subject'>인물·장소 외형</option>
     </select>
    </label>
    <span className='small muted'>생성 요청 시 선택한 이미지를 OpenAI에 전달해요. 사용할 권한이 있는 5 MiB 이하 이미지를 선택해 주세요.</span>
   </>}
   <label>고정 시각 설정 (선택)<textarea value={vm.visualSettings} onChange={e=>vm.setVisualSettings(e.target.value)} maxLength={6000} disabled={disabled || vm.busy || !!running} placeholder='그림체·색감·반복되는 인물 외형이나 건축물의 특징' /></label>
   <span className='small muted'>같은 그림체와 특징을 유지하려면 이 설정을 두고 아래 장면만 바꿔 주세요.</span>
   <label>이번 장면<textarea value={vm.prompt} onChange={e=>vm.setPrompt(e.target.value)} maxLength={12000} disabled={disabled || vm.busy || !!running} placeholder='장소·등장 대상과 행동·시간대·전달할 분위기' /></label>
   <button type='button' className='btn sm' disabled={locked || !vm.prompt.trim() || !referenceReady} onClick={()=>void vm.generate()}>생성 요청</button>
   {running && <span role='status'>{vm.job?.stage==='uploading'?'이미지 저장 중':'이미지 생성 대기·진행 중'}</span>}
   {vm.error && <span role='alert'>{vm.error}{<button type='button' className='btn sm' onClick={vm.retry}>상태 다시 확인</button>}</span>}
   {vm.preview && <span><img src={vm.preview} alt='생성 이미지 미리보기' style={{maxWidth:180}} /><button type='button' className='btn sm' disabled={disabled} onClick={()=>{const file=vm.file();if(file){onPick?.(file);setOpen(false)}}}>이 이미지 선택</button></span>}
   <span className='small muted'>선택 후 기존 저장 버튼으로 표지를 저장해요. 화면을 닫아도 생성은 계속돼요.</span>
  </span>}
 </span>
}
