import { expect, it } from 'vitest'
import { newSetting } from './studioWorld'
import { studioSections, sectionOf } from './studioSections'

it('creates original authoring and setting-book sections without requiring AI topics',()=>{
 expect(studioSections.map(s=>s.label)).toEqual(['인물','장소','기본 설정','시공간·장소','역사','사회·조직','문화·기술','특수 규칙','주요 갈등','집필 메모'])
 for(const section of studioSections) {
  const s=newSetting(section.id)
  expect(sectionOf(s.item)).toBe(section.id)
  expect(s.item.topics).toEqual([])
  expect(s.userCategory).toBe('설정')
 }
 expect(sectionOf(newSetting().item)).toBe('basic')
})
