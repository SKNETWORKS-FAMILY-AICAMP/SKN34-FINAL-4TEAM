import { expect,it } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { timelineLayout } from './worldTimeline'
it('positions successors after predecessors, keeps branches separate and ignores pending events',()=>{
 const items=['b','c','a','pending'].map(id=>{const s=newSetting('history');s.item.id=id;s.item.kind='event';return s.item})
 items[0].afterId='a';items[1].afterId='a';items[3].decision='pending'
 const layout=timelineLayout(items)
 expect(layout.map(n=>[n.item.id,n.column,n.row])).toEqual([['b',1,0],['c',1,1],['a',0,0]])
})
it('terminates for cyclic or missing predecessor references',()=>{
 const items=['a','b','c'].map(id=>{const s=newSetting('history');s.item.id=id;s.item.kind='event';return s.item})
 items[0].afterId='b';items[1].afterId='a';items[2].afterId='missing'
 expect(timelineLayout(items).every(n=>Number.isFinite(n.column))).toBe(true)
})
