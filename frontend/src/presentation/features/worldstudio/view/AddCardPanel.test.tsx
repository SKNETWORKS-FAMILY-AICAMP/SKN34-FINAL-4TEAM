// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cardTypes } from '../../../../domain/entities/studioCards'
import { AddCardPanel } from './AddCardPanel'
afterEach(cleanup)

it('8유형(인물·장소·조직·능력·사물·규칙·사건·기타)을 버튼으로 보이고, 고르면 그 유형으로 추가를 부르며, 열리면 검색 칸으로 초점이 간다',()=>{
 const onAdd=vi.fn()
 render(<AddCardPanel onAdd={onAdd} onClose={vi.fn()}/>)
 const dialog=screen.getByRole('dialog',{name:'설정 추가'})
 expect(document.activeElement).toBe(screen.getByRole('searchbox',{name:'설정 유형 검색'}))
 const buttons=Array.from(dialog.querySelectorAll('li button'),b=>b.textContent)
 expect(buttons).toEqual(cardTypes.map(t=>t.label))
 expect(buttons).toHaveLength(8)
 fireEvent.click(screen.getByRole('button',{name:'장소'}))
 expect(onAdd).toHaveBeenCalledWith('location')
})

it('이름으로 검색하면 맞는 유형만 남고, 없으면 안내하며, 지우면 8유형이 돌아온다',()=>{
 render(<AddCardPanel onAdd={vi.fn()} onClose={vi.fn()}/>)
 const search=screen.getByRole('searchbox',{name:'설정 유형 검색'})
 fireEvent.change(search,{target:{value:'인'}})
 expect(screen.getAllByRole('button').map(b=>b.textContent).filter(t=>cardTypes.some(c=>c.label===t))).toEqual(['인물'])
 fireEvent.change(search,{target:{value:'없는이름'}})
 expect(screen.getByText('맞는 유형이 없어요.')).toBeTruthy()
 fireEvent.change(search,{target:{value:''}})
 expect(screen.getByRole('button',{name:'기타'})).toBeTruthy()
})

it('Esc와 닫기 버튼은 닫기를 부르고, 처리 중(busy)에는 유형 버튼이 잠긴다',()=>{
 const onClose=vi.fn(),onAdd=vi.fn()
 const {rerender}=render(<AddCardPanel onAdd={onAdd} onClose={onClose}/>)
 fireEvent.keyDown(screen.getByRole('dialog',{name:'설정 추가'}),{key:'Escape'})
 expect(onClose).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'닫기'}))
 expect(onClose).toHaveBeenCalledTimes(2)
 rerender(<AddCardPanel onAdd={onAdd} onClose={onClose} busy/>)
 const person=screen.getByRole<HTMLButtonElement>('button',{name:'인물'})
 expect(person.disabled).toBe(true)
 fireEvent.click(person)
 expect(onAdd).not.toHaveBeenCalled()
})
