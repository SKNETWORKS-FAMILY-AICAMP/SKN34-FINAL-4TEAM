// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { newSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { WorldWiki } from './WorldWiki'
afterEach(cleanup)
it('follows saved relationships and backlinks between wiki documents and keeps candidates out',()=>{
 const a=newSetting('people'),b=newSetting('people'),event=newSetting('history'),pending=newSetting('people'),relation=newSetting()
 a.item.id='a';a.item.title='길동';a.item.text='서자로 태어난 인물'
 b.item.id='b';b.item.title='홍문';b.item.text='길동의 아버지'
 event.item.kind='event';event.item.title='호칭을 청한 밤';event.item.relatedIds=['a'];event.item.text='아버지를 찾아간 사건'
 pending.item.title='미확정 인물';pending.item.decision='pending'
 relation.item={...relation.item,kind:'relation',subjectId:'a',targetId:'b',predicate:'child_of',title:'부자 관계'}
 const world:StudioWorld={id:'w',name:'홍길동전',description:'세계관',version:1,analysis:null,settings:[a,b,event,pending,relation]}
 render(<WorldWiki world={world}/> )
 expect(screen.queryByText('미확정 인물')).toBeNull()
 expect(screen.getByRole('navigation',{name:'문서 목차'})).toBeTruthy()
 fireEvent.click(within(screen.getByRole('region',{name:'인물 관계'})).getByRole('button',{name:'홍문'}))
 expect(screen.getByRole('heading',{name:'홍문',level:3})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'이전 문서'}))
 expect(screen.getByRole('heading',{name:'길동',level:3})).toBeTruthy()
 fireEvent.click(within(screen.getByRole('region',{name:'관련 사건'})).getByRole('button',{name:'호칭을 청한 밤'}))
 expect(screen.getByRole('heading',{name:'호칭을 청한 밤',level:3})).toBeTruthy()
 fireEvent.change(screen.getByRole('searchbox',{name:'문서 검색'}),{target:{value:'없는문서'}})
 expect(screen.getByText('일치하는 문서가 없습니다.')).toBeTruthy()
 expect(screen.getByRole('heading',{name:'호칭을 청한 밤',level:3})).toBeTruthy()
})
