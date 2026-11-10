import { useState } from 'react'
import type { EpisodeCheckpoint } from '../../../../domain/entities/content'

/** DEC-43: 발행한 저장 버전이 체크포인트다. 현재 공개가 아닌 항목은 공개 권리를 확인한 뒤 다시 발행해 되돌린다. */
export function CheckpointPanel({checkpoints,disabled,onRevert}:{checkpoints:EpisodeCheckpoint[];disabled:boolean;onRevert:(versionId:string,rights:boolean)=>Promise<boolean>}) {
  const [rights,setRights]=useState(false)
  if(!checkpoints.length)return null
  return <section className="writing-checkpoints" aria-label="발행 체크포인트">
    <h3>발행 체크포인트</h3>
    <p className="small muted">발행한 저장 버전이 체크포인트예요. 독자에게는 현재 공개 중인 하나만 보여요. 되돌려도 다른 체크포인트와 이력은 지워지지 않아요.</p>
    <ol>{checkpoints.map((c,i)=><li key={c.versionId} className={c.active?'on':undefined}>
      <span>체크포인트 {i+1} · {new Date(c.publishedAt).toLocaleString('ko-KR')}{c.active&&' · 현재 공개'}</span>
      {!c.active&&<button type="button" className="btn sm" disabled={disabled||!rights} onClick={async()=>{if(await onRevert(c.versionId,rights))setRights(false)}}>이 체크포인트로 되돌리기</button>}
    </li>)}</ol>
    {checkpoints.some(c=>!c.active)&&<label className="writing-rights"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> 이 체크포인트를 다시 공개할 권리가 있음을 확인합니다.</label>}
  </section>
}
