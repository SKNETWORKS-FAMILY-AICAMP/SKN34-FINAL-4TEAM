// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {WorldRevisions} from './WorldRevisions'
import type {useWorldRevisions} from '../viewmodel/useWorldRevisions'
import type {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
import type {StudioSetting,WorldRevision} from '../../../../domain/entities/studioWorld'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('explains the superseding version and connects explicit acknowledgement without calling confirm',()=>{
 const confirm=vi.fn(),acknowledgeSuperseded=vi.fn()
 // 훅은 편집 화면(버전 그래프)이 한 번 호출해 시트에 넘기므로 결과를 직접 준다.
 const revisions:ReturnType<typeof useWorldRevisions>={rows:[],detail:null,busy:false,error:'',message:'',pending:true,aiPending:false,supported:true,
  superseded:{key:'private-key',expectedDraftRevision:2,revisionId:'private-id',revisionNo:1,currentRevisionNo:2},
  open:vi.fn(),refresh:vi.fn(),confirm,acknowledgeSuperseded,restore:vi.fn()}
 const studio={reviewWorldId:'world',saved:{currentRevisionId:'current'},dirty:false,relationDirty:false,sealIssues:[],reload:vi.fn(),setReviewBusy:vi.fn()} as unknown as ReturnType<typeof useWorldStudioViewModel>
 const view=render(<WorldRevisions studio={studio} revisions={revisions}/> )
 expect(screen.getByText(/확정 버전 1 저장 완료, 이후 새 버전/)).toBeTruthy()
 expect(screen.getByText(/최신 기준: 확정 버전 2/)).toBeTruthy()
 expect(screen.queryByText(/확정 결과가 미확인이에요/)).toBeNull()
 expect(view.container.textContent).not.toContain('private-key')
 expect(view.container.textContent).not.toContain('private-id')
 fireEvent.click(screen.getByRole('button',{name:'결과 확인 후 계속 작성'}))
 expect(acknowledgeSuperseded).toHaveBeenCalledTimes(1);expect(confirm).not.toHaveBeenCalled()
 view.rerender(<WorldRevisions studio={{...studio,dirty:true}} revisions={revisions}/> )
 expect(screen.getByRole('button',{name:'결과 확인 후 계속 작성'}).hasAttribute('disabled')).toBe(true)
})

// --- 확정 버전으로 초안 되돌리기 ---
const savedCard=(id:string)=>({item:{id,kind:'entity'}}) as unknown as StudioSetting
const savedRelation=(id:string)=>({item:{id,kind:'relation'}}) as unknown as StudioSetting
const snapshotCard=(id:string,title:string,lifecycle:'active'|'removed'='active')=>({versionId:'v-'+id,versionNo:1,restoredFromVersionId:null,card:{id,title,body:'본문',cardType:'character',areaCode:'basic',classification:'',aliases:[],tags:[],semanticMetadata:{},visibility:'private',lifecycle}}) as unknown as WorldRevision['cards'][number]
const detail:WorldRevision={worldId:'world',revisionId:'rev-1',revisionNo:3,name:'확정 이름',description:'확정 소개',parentRevisionId:null,restoredFromRevisionId:null,relationshipStatus:'not_recorded',relationships:null,
 cards:[snapshotCard('a','가람'),snapshotCard('b','나래','removed')]}
// 지금 초안: a(그 버전에도 있음)·c·d(그 버전에 없음) + 관계 하나(카드가 아님)
const settings=[savedCard('a'),savedCard('c'),savedCard('d'),savedRelation('r')]
function restoring(change:{dirty?:boolean;relationDirty?:boolean;busy?:boolean;pending?:boolean;aiPending?:boolean;settings?:StudioSetting[]}={}){
 const restore=vi.fn()
 const revisions={rows:[],detail,busy:change.busy??false,error:'',message:'',pending:change.pending??false,aiPending:change.aiPending??false,supported:true,superseded:null,
  open:vi.fn(),refresh:vi.fn(),confirm:vi.fn(),acknowledgeSuperseded:vi.fn(),restore} as unknown as ReturnType<typeof useWorldRevisions>
 const studio={reviewWorldId:'world',saved:{currentRevisionId:'current',settings:change.settings??settings},dirty:change.dirty??false,relationDirty:change.relationDirty??false,sealIssues:[]} as unknown as ReturnType<typeof useWorldStudioViewModel>
 render(<WorldRevisions studio={studio} revisions={revisions}/>)
 return {restore,button:()=>screen.getByRole<HTMLButtonElement>('button',{name:'이 버전으로 초안 되돌리기'})}
}
it('asks first with how many cards vanish and what stays, and restores only after the author agrees',()=>{
 const {restore,button}=restoring()
 const ask=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(button())
 expect(ask).toHaveBeenCalledTimes(1)
 const text=String(ask.mock.calls[0][0])
 expect(text).toContain('확정 버전 3');expect(text).toContain('사라지는 설정 카드 2개') // 관계는 세지 않는다
 expect(text).toContain('관계는 그대로');expect(text).toContain('과거 이미지까지 보장하지 않아요');expect(text).toContain('새 확정 버전은 만들지 않아요')
 expect(restore).not.toHaveBeenCalled()
 ask.mockReturnValue(true);fireEvent.click(button())
 expect(restore).toHaveBeenCalledExactlyOnceWith('rev-1',3)
})
it('says that no card vanishes when the draft has no card the version lacks',()=>{
 const {button}=restoring({settings:[savedCard('a'),savedRelation('r')]})
 const ask=vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(button())
 expect(String(ask.mock.calls[0][0])).toContain('사라지는 설정 카드는 없어요')
})
it.each([
 ['dirty','저장하지 않은 변경이 있어 되돌릴 수 없어요',{dirty:true}],['relationDirty','저장하지 않은 변경이 있어 되돌릴 수 없어요',{relationDirty:true}],
 ['pending','확정 결과를 확인하기 전에는 되돌릴 수 없어요',{pending:true}],['aiPending','AI 요청 결과를 확인하기 전에는 되돌릴 수 없어요',{aiPending:true}],
] as const)('locks the restore with the reason while %s',(_name,reason,change)=>{
 const {restore,button}=restoring(change)
 expect(button().disabled).toBe(true)
 expect(screen.getByText(new RegExp(reason))).toBeTruthy()
 expect(button().getAttribute('aria-describedby')).toBe(screen.getByText(new RegExp(reason)).id)
 const ask=vi.spyOn(window,'confirm');fireEvent.click(button())
 expect(ask).not.toHaveBeenCalled();expect(restore).not.toHaveBeenCalled()
})
it('locks the restore while another request runs and says nothing when it is free',()=>{
 const busy=restoring({busy:true});expect(busy.button().disabled).toBe(true);cleanup()
 const free=restoring();expect(free.button().disabled).toBe(false);expect(free.button().hasAttribute('aria-describedby')).toBe(false)
})
it('no longer says that restoring a version is unsupported, and keeps saying the past relations are not recorded',()=>{
 restoring()
 expect(screen.queryByText(/복원 기능도 지원하지 않아요/)).toBeNull()
 expect(screen.getByRole('note').textContent).toContain('관계의 과거 상태는 저장하지 않아요')
})
