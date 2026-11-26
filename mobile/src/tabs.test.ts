import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectedTab, TABS } from './tabs.ts'

const BASE = 'http://localhost:5173'
const at = (path: string) => BASE + path

test('TABS: 하단 탭 5개와 웹 경로(frontend/src/App.tsx의 실제 라우트)', () => {
  assert.deepEqual(TABS.map((tab) => [tab.key, tab.label, tab.path]), [
    ['home', '홈', '/'],
    ['explore', '탐색', '/search'],
    ['library', '내 서재', '/lib'],
    ['notifications', '알림', '/notifications'],
    ['me', '내 정보', '/me/profile'],
  ])
})

test('selectedTab: 각 탭의 경로는 그 탭을 고른다', () => {
  for (const tab of TABS) assert.equal(selectedTab(at(tab.path), BASE), tab.key, tab.key)
})

test('selectedTab: 웹 GNB가 켜는 메뉴를 따라 화면을 탭에 묶는다', () => {
  const cases: [string, string][] = [
    ['/', 'home'],
    ['/?genre=fantasy', 'home'],
    ['/#top', 'home'],
    ['/search?type=work&q=%EB%8B%AC', 'explore'],
    ['/worlds', 'explore'],
    ['/worlds/w1', 'explore'],
    ['/worlds/w1/cards/c1', 'explore'],
    ['/rank', 'explore'],
    ['/chat', 'explore'],
    ['/chat/w1/2', 'explore'],
    ['/tag/%EC%84%A0%EB%B0%B0', 'explore'],
    ['/ifs', 'explore'],
    ['/lib?tab=write', 'library'],
    ['/lib/', 'library'],
    ['/studio/abc?view=narrative', 'library'],
    ['/content?work=abc', 'library'],
    ['/worldstudio', 'library'],
    ['/worldstudio/w1', 'library'],
    ['/inbox?i=1', 'library'], // 독자 피드백함이다(알림함은 /notifications)
    ['/import', 'library'],
    ['/new', 'library'],
    ['/write', 'library'],
    ['/fork/abc', 'library'],
    ['/notifications', 'notifications'],
    ['/me', 'me'],
    ['/me/pay', 'me'],
    ['/me/notice?id=1', 'me'],
  ]
  for (const [path, tab] of cases) assert.equal(selectedTab(at(path), BASE), tab, path)
})

test('selectedTab: 어느 탭에도 속하지 않는 화면과 경로 접두가 같은 다른 화면은 고르지 않는다', () => {
  for (const path of ['/work/abc', '/work/abc/wiki', '/read/abc/1', '/login', '/me/signup', '/me/signup?x=1', '/admin', '/status', '/no-such',
    '/searching', '/libx', '/meeting', '/notificationsx', '/worldstudios', '/homepage']) {
    assert.equal(selectedTab(at(path), BASE), null, path)
  }
})

test('selectedTab: 우리 웹이 아니거나 주소가 아니면 고르지 않는다', () => {
  for (const url of ['', 'about:blank', '/lib', 'https://evil.test/lib', 'http://localhost:5173.evil.test/lib', 'http://localhost:5173@evil.test/lib', 'javascript:alert(1)']) {
    assert.equal(selectedTab(url, BASE), null, url)
  }
  assert.equal(selectedTab('HTTP://LOCALHOST:5173/lib', BASE), 'library') // 출처 비교는 대소문자를 가리지 않는다
})
