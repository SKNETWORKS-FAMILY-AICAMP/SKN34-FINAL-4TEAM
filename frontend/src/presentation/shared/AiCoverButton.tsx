import { useState } from 'react'
import type { ImageRequest } from '../../domain/repositories/ImageGenerationRepository'
import { useImageGeneration } from './useImageGeneration'
type Props = { purpose?:Extract<ImageRequest['purpose'],'work_cover'|'world_cover'>; workId?:string; worldId?:string; disabled?:boolean; onPick?:(file:File)=>void }
/** 생성 결과는 명시적으로 선택한 뒤 기존 표지 저장 흐름에 전달한다. */
export function AiCoverButton({purpose='work_cover',workId,worldId,onPick,disabled=false}:Props) {
 const [open,setOpen]=useState(false)
 const vm=useImageGeneration({purpose,workId,worldId})
 const running=vm.job && ['accepted','queued','running'].includes(vm.job.status)
 return <span className='ep-cover-ai'>
  <button type='button' className='btn sm' disabled={disabled || !onPick || import.meta.env.MODE==='mockup'} onClick={()=>setOpen(!open)}><span aria-hidden='true'>✦</span> AI로 생성</button>
  {open && <span role='group' aria-label='AI 이미지 생성'>
   <label>고정 시각 설정 (선택)<textarea value={vm.visualSettings} onChange={e=>vm.setVisualSettings(e.target.value)} maxLength={6000} disabled={disabled || vm.busy || !!running} placeholder='그림체·색감·반복되는 인물 외형이나 건축물의 특징' /></label>
   <span className='small muted'>같은 그림체와 특징을 유지하려면 이 설정을 두고 아래 장면만 바꿔 주세요.</span>
   <label>이번 장면<textarea value={vm.prompt} onChange={e=>vm.setPrompt(e.target.value)} maxLength={12000} disabled={disabled || vm.busy || !!running} placeholder='장소·등장 대상과 행동·시간대·전달할 분위기' /></label>
   <button type='button' className='btn sm' disabled={disabled || vm.busy || !!running || !vm.prompt.trim()} onClick={()=>void vm.generate()}>생성 요청</button>
   {running && <span role='status'>{vm.job?.stage==='uploading'?'이미지 저장 중':'이미지 생성 대기·진행 중'}</span>}
   {vm.error && <span role='alert'>{vm.error}{<button type='button' className='btn sm' onClick={vm.retry}>상태 다시 확인</button>}</span>}
   {vm.preview && <span><img src={vm.preview} alt='생성 이미지 미리보기' style={{maxWidth:180}} /><button type='button' className='btn sm' disabled={disabled} onClick={()=>{const file=vm.file();if(file){onPick?.(file);setOpen(false)}}}>이 이미지 선택</button></span>}
   <span className='small muted'>선택 후 기존 저장 버튼으로 표지를 저장해요. 화면을 닫아도 생성은 계속돼요.</span>
  </span>}
 </span>
}
