import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isSameOrigin, navigationDecision, tapDestination } from './webview.ts'

const BASE = 'http://localhost:5173'

describe('isSameOrigin', () => {
  it('scheme·host·port가 모두 같을 때만 같은 origin이다(대소문자·경로·쿼리는 무시)', () => {
    assert.equal(isSameOrigin('http://localhost:5173/work/1?x=1#a', BASE), true)
    assert.equal(isSameOrigin('HTTP://LOCALHOST:5173/', BASE), true)
    assert.equal(isSameOrigin('http://localhost:5173', 'http://localhost:5173/app/'), true)
    assert.equal(isSameOrigin('http://localhost:5174/', BASE), false)
    assert.equal(isSameOrigin('https://localhost:5173/', BASE), false)
    assert.equal(isSameOrigin('http://127.0.0.1:5173/', BASE), false)
  })

  it('비슷하게 생긴 주소(호스트 뒤에 덧붙인 도메인·userinfo)를 같은 origin으로 보지 않는다', () => {
    assert.equal(isSameOrigin('http://localhost:5173.evil.test/', BASE), false)
    assert.equal(isSameOrigin('http://localhost:5173@evil.test/', BASE), false)
    assert.equal(isSameOrigin('//localhost:5173/', BASE), false)
    assert.equal(isSameOrigin('/work/1', BASE), false)
  })
})

describe('navigationDecision (WebView 안의 이동)', () => {
  it('같은 origin과 about:blank는 WebView에서 연다', () => {
    assert.equal(navigationDecision('http://localhost:5173/work/1', BASE), 'allow')
    assert.equal(navigationDecision('about:blank', BASE), 'allow')
  })

  it('다른 origin의 http(s)·mailto·tel은 시스템(브라우저·메일·전화)으로 보낸다', () => {
    assert.equal(navigationDecision('https://example.com/a', BASE), 'external')
    assert.equal(navigationDecision('http://localhost:5174/', BASE), 'external')
    assert.equal(navigationDecision('mailto:help@example.com', BASE), 'external')
    assert.equal(navigationDecision('tel:+8212345678', BASE), 'external')
  })

  it('그 밖의 scheme(javascript·file·data·intent·앱 scheme)은 열지 않는다', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'intent://x#Intent;end', 'storyfork://x', 'itms-apps://x']) {
      assert.equal(navigationDecision(url, BASE), 'block', url)
    }
  })
})

describe('tapDestination (알림을 눌렀을 때 WebView가 갈 주소)', () => {
  it('알림 데이터를 웹 noticeTarget 규칙의 경로로 바꿔 우리 origin 주소로 만든다', () => {
    assert.equal(tapDestination({ kind: 'creation', targetType: 'work', targetId: 'w 1' }, BASE), 'http://localhost:5173/work/w%201')
    assert.equal(tapDestination({ kind: 'credit', targetType: 'credit-expiry' }, BASE), 'http://localhost:5173/me/pay')
    assert.equal(tapDestination({ kind: 'ai-tool', targetType: 'world', targetId: 'w1' }, 'https://storyfork.example/'), 'https://storyfork.example/worldstudio/w1')
  })

  it('이동 대상이 없거나 형식이 다르면 이동하지 않는다', () => {
    assert.equal(tapDestination(undefined, BASE), null)
    assert.equal(tapDestination({ kind: 'result', targetType: null, targetId: null }, BASE), null)
    assert.equal(tapDestination({ kind: 'unknown', targetType: 'work', targetId: 'w1' }, BASE), null)
    assert.equal(tapDestination('/work/1', BASE), null)
  })
})
