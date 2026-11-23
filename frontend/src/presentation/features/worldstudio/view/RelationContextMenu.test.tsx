// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RelationContextMenu, type MenuEntry } from './RelationContextMenu'
afterEach(cleanup)

const entries=(onEdit=vi.fn(),onDelete=vi.fn()):MenuEntry[]=>[{label:'정보 편집',onSelect:onEdit},{label:'삭제',onSelect:onDelete,disabled:true,reason:'설정 삭제는 최신 회차에서 할 수 있어요.'}]

it('role=menu에 항목을 menuitem으로 보이고, 항목을 고르면 먼저 닫은 뒤 그 동작을 하며, 열리면 첫 항목으로 초점이 간다',()=>{
 const onEdit=vi.fn(),onClose=vi.fn()
 const opener=document.createElement('button');document.body.append(opener);opener.focus()
 render(<RelationContextMenu label="가람 카드 메뉴" x={10} y={20} entries={entries(onEdit)} onClose={onClose}/>)
 const menu=screen.getByRole('menu',{name:'가람 카드 메뉴'})
 expect(within(menu).getAllByRole('menuitem').map(i=>i.textContent)).toEqual(['정보 편집','삭제'])
 expect(document.activeElement).toBe(within(menu).getByRole('menuitem',{name:'정보 편집'}))
 fireEvent.click(within(menu).getByRole('menuitem',{name:'정보 편집'}))
 expect(onClose).toHaveBeenCalledTimes(1)
 expect(onEdit).toHaveBeenCalledTimes(1)
 expect(document.activeElement).toBe(opener) // 동작(시트 열기 등)이 시작될 때 초점은 이미 처음 자리로 돌아와 있다
 opener.remove()
})

it('잠긴 항목은 aria-disabled로 초점은 받되 눌러도 아무 일이 없고, 잠긴 이유가 그 항목의 설명으로 읽힌다',()=>{
 const onDelete=vi.fn(),onClose=vi.fn()
 render(<RelationContextMenu label="가람 카드 메뉴" x={0} y={0} entries={entries(vi.fn(),onDelete)} onClose={onClose}/>)
 const locked=screen.getByRole('menuitem',{name:'삭제'})
 expect(locked.getAttribute('aria-disabled')).toBe('true')
 const reason=screen.getByText('설정 삭제는 최신 회차에서 할 수 있어요.')
 expect(locked.getAttribute('aria-describedby')).toBe(reason.id)
 fireEvent.click(locked)
 expect(onDelete).not.toHaveBeenCalled()
 expect(onClose).not.toHaveBeenCalled()
})

it('하위 목록이 있는 항목은 누르면 펼쳐지고(aria-expanded) 고른 하위 항목의 동작을 하며, 방향키로 오가고 오른쪽·왼쪽 키로 펼치고 접는다',()=>{
 const pick=vi.fn(),onClose=vi.fn()
 render(<RelationContextMenu label="캔버스 메뉴" x={0} y={0} onClose={onClose} entries={[{label:'여기에 설정 추가',items:[{label:'인물',onSelect:()=>pick('character')},{label:'장소',onSelect:()=>pick('location')}]},{label:'배치 정돈',onSelect:vi.fn()}]}/>)
 const parent=screen.getByRole('menuitem',{name:'여기에 설정 추가'})
 expect(parent.getAttribute('aria-haspopup')).toBe('menu')
 expect(parent.getAttribute('aria-expanded')).toBe('false')
 expect(screen.queryByRole('menuitem',{name:'인물'})).toBeNull()
 fireEvent.keyDown(parent,{key:'ArrowRight'})
 expect(parent.getAttribute('aria-expanded')).toBe('true')
 expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'인물'})) // 펼치면 첫 하위 항목으로
 fireEvent.keyDown(document.activeElement!,{key:'ArrowDown'})
 expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'장소'}))
 fireEvent.keyDown(document.activeElement!,{key:'ArrowLeft'})
 expect(parent.getAttribute('aria-expanded')).toBe('false')
 expect(document.activeElement).toBe(parent)
 fireEvent.click(parent)
 fireEvent.click(screen.getByRole('menuitem',{name:'장소'}))
 expect(pick).toHaveBeenCalledWith('location')
 expect(onClose).toHaveBeenCalledTimes(1)
})

it('방향키·Home·End로 항목을 옮기고, Esc·메뉴 밖 누르기·창 크기 변경은 닫으며 메뉴 안 누르기는 닫지 않는다',()=>{
 const onClose=vi.fn()
 render(<><button>밖</button><RelationContextMenu label="m" x={0} y={0} onClose={onClose} entries={[{label:'가',onSelect:vi.fn()},{label:'나',onSelect:vi.fn()},{label:'다',onSelect:vi.fn()}]}/></>)
 const [a,b,c]=screen.getAllByRole('menuitem')
 expect(document.activeElement).toBe(a)
 fireEvent.keyDown(a,{key:'ArrowDown'});expect(document.activeElement).toBe(b)
 fireEvent.keyDown(b,{key:'End'});expect(document.activeElement).toBe(c)
 fireEvent.keyDown(c,{key:'ArrowDown'});expect(document.activeElement).toBe(a) // 끝에서 처음으로
 fireEvent.keyDown(a,{key:'ArrowUp'});expect(document.activeElement).toBe(c)
 fireEvent.keyDown(c,{key:'Home'});expect(document.activeElement).toBe(a)
 fireEvent.pointerDown(a)
 expect(onClose).not.toHaveBeenCalled()
 fireEvent.pointerDown(screen.getByRole('button',{name:'밖'}))
 expect(onClose).toHaveBeenCalledTimes(1)
 fireEvent.keyDown(a,{key:'Escape'})
 expect(onClose).toHaveBeenCalledTimes(2)
 fireEvent(window,new Event('resize'))
 expect(onClose).toHaveBeenCalledTimes(3)
})

it('이미 펼친 하위 목록의 부모 항목에서도 오른쪽 키는 첫 하위 항목으로 초점을 옮긴다',()=>{
 render(<RelationContextMenu label="캔버스 메뉴" x={0} y={0} onClose={vi.fn()} entries={[{label:'여기에 설정 추가',items:[{label:'인물',onSelect:vi.fn()},{label:'장소',onSelect:vi.fn()}]}]}/>)
 const parent=screen.getByRole('menuitem',{name:'여기에 설정 추가'})
 fireEvent.click(parent) // 눌러서 펼치면 초점은 부모 항목에 남는다
 parent.focus()
 expect(parent.getAttribute('aria-expanded')).toBe('true')
 expect(document.activeElement).toBe(parent)
 fireEvent.keyDown(parent,{key:'ArrowRight'})
 expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'인물'}))
})

it('메뉴 밖의 스크롤은 메뉴를 닫지만, 키가 큰 메뉴를 안에서 미는 스크롤은 닫지 않는다',()=>{
 const onClose=vi.fn()
 render(<><div data-testid="page"/><RelationContextMenu label="m" x={0} y={0} onClose={onClose} entries={[{label:'가',onSelect:vi.fn()}]}/></>)
 fireEvent.scroll(screen.getByRole('menu'))
 expect(onClose).not.toHaveBeenCalled()
 fireEvent.scroll(screen.getByTestId('page'))
 expect(onClose).toHaveBeenCalledTimes(1)
})
