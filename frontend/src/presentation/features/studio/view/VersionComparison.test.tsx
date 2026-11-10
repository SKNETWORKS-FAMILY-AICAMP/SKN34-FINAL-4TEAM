// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VersionComparison } from './VersionComparison'
import { useVersionComparisonViewModel } from '../viewmodel/useVersionComparisonViewModel'

vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p> }))
afterEach(cleanup)
it('두 저장본을 선택해 비교하며 같은 버전은 비교하지 않는다', () => {
  const versions = [
    { id: 'a', title: '제목', body: '이전', episode: 1, revision: 1, savedAt: '2026-11-04T00:00:00Z' },
    { id: 'b', title: '제목', body: '변경', episode: 1, revision: 2, savedAt: '2026-11-04T01:00:00Z' },
  ]
  function Comparison() {
    const model = useVersionComparisonViewModel(versions, 'w:1')
    return <VersionComparison workId="w" number={1} versions={versions} model={model} />
  }
  render(<Comparison />)
  fireEvent.change(screen.getByLabelText('기준 원고 버전'), { target: { value: 'a' } })
  fireEvent.change(screen.getByLabelText('비교 원고 버전'), { target: { value: 'b' } })
  expect(screen.getByRole('region', { name: '원고 변경 내용' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('비교 원고 버전'), { target: { value: 'a' } })
  expect(screen.getByText('서로 다른 저장 버전 두 개를 선택해 주세요.')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '원고 변경 내용' })).toBeNull()
})

it('작가의 말만 달라져도 변경으로 표시한다', () => {
  const versions = ['이전 후기','다음 후기'].map((authorNote,i)=>({id:String(i),title:'제목',body:'본문',episode:1,revision:i,savedAt:'2026-11-10T00:00:00Z',authorNote}))
  function Comparison() {
    const model=useVersionComparisonViewModel(versions,'w:1')
    return <VersionComparison workId="w" number={1} versions={versions} model={model}/>
  }
  render(<Comparison/> )
  fireEvent.change(screen.getByLabelText('기준 원고 버전'),{target:{value:'0'}})
  fireEvent.change(screen.getByLabelText('비교 원고 버전'),{target:{value:'1'}})
  expect(screen.queryByText('두 버전의 내용이 같아요.')).toBeNull()
  expect(within(screen.getByRole('region',{name:'원고 변경 내용'})).getByRole('heading',{name:'작가의 말'})).toBeTruthy()
})
