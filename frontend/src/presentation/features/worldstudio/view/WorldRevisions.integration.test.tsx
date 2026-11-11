// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {WorldRevisions} from './WorldRevisions'
import {useWorldRevisions} from '../viewmodel/useWorldRevisions'
import type {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
vi.mock('../viewmodel/useWorldRevisions',()=>({useWorldRevisions:vi.fn()}))
afterEach(cleanup)
it('explains the superseding version and connects explicit acknowledgement without calling confirm',()=>{
 const confirm=vi.fn(),acknowledgeSuperseded=vi.fn()
 vi.mocked(useWorldRevisions).mockReturnValue({rows:[],detail:null,busy:false,error:'',message:'',pending:true,aiPending:false,supported:true,
  superseded:{key:'private-key',expectedDraftRevision:2,revisionId:'private-id',revisionNo:1,currentRevisionNo:2},
  open:vi.fn(),refresh:vi.fn(),confirm,acknowledgeSuperseded})
 const studio={reviewWorldId:'world',tool:'versions',saved:{currentRevisionId:'current'},dirty:false,relationDirty:false,reload:vi.fn(),setReviewBusy:vi.fn()} as unknown as ReturnType<typeof useWorldStudioViewModel>
 const view=render(<WorldRevisions studio={studio}/> )
 expect(screen.getByText(/확정 버전 1 저장 완료, 이후 새 버전/)).toBeTruthy()
 expect(screen.getByText(/최신 기준은 확정 버전 2/)).toBeTruthy()
 expect(screen.queryByText(/확정 결과가 미확인입니다/)).toBeNull()
 expect(view.container.textContent).not.toContain('private-key')
 expect(view.container.textContent).not.toContain('private-id')
 fireEvent.click(screen.getByRole('button',{name:'결과 확인 후 계속 작성'}))
 expect(acknowledgeSuperseded).toHaveBeenCalledTimes(1);expect(confirm).not.toHaveBeenCalled()
 view.rerender(<WorldRevisions studio={{...studio,dirty:true}}/> )
 expect(screen.getByRole('button',{name:'결과 확인 후 계속 작성'}).hasAttribute('disabled')).toBe(true)
})
