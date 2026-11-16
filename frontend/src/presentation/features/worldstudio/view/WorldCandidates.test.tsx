// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { WorldCandidates } from './WorldCandidates'
afterEach(cleanup)
it('shows saved AI candidates with their source quotes as unconfirmed, without an approve action',()=>{
 const c={...newSetting().item,id:'c1',title:'길동은 이미 집을 떠났다',decision:'pending' as const,origin:'extraction' as const,evidence:[{sourceId:'ep2',quote:'등잔 맞은편에 앉았다'}]}
 render(<WorldCandidates analysis={{id:'r',status:'review',issues:[],candidates:[c]}}/>)
 expect(screen.getByRole('heading',{name:/미확정/})).toBeTruthy()
 expect(screen.getByText('길동은 이미 집을 떠났다')).toBeTruthy()
 expect(screen.getByText(/등잔 맞은편에 앉았다/)).toBeTruthy()
 expect(screen.queryByRole('button',{name:/확정/})).toBeNull()
})
it('says no candidates exist when nothing was saved',()=>{
 render(<WorldCandidates analysis={null}/>)
 expect(screen.getByText(/저장된 AI 후보가 없어요/)).toBeTruthy()
})
