import assert from 'node:assert/strict'
import { it } from 'node:test'

import { apiBaseUrl, webUrl } from './config.ts'

it('서버 주소는 값이 없거나 비어 있으면(빈 환경변수 포함) 기본값(로컬 Compose의 web)이고 끝 슬래시는 버린다', () => {
  assert.equal(apiBaseUrl(undefined), 'http://localhost:5173')
  assert.equal(apiBaseUrl(''), 'http://localhost:5173')
  assert.equal(apiBaseUrl('   '), 'http://localhost:5173')
  assert.equal(apiBaseUrl('https://storyfork.example/'), 'https://storyfork.example')
  assert.equal(apiBaseUrl(' http://localhost:5174 '), 'http://localhost:5174')
})

it('웹 주소는 API 기준 origin 뒤에 경로를 붙인다(기준 주소의 경로·끝 슬래시는 버린다)', () => {
  assert.equal(webUrl('/work/a%20b', 'http://localhost:5173'), 'http://localhost:5173/work/a%20b')
  assert.equal(webUrl('/me/pay', 'http://10.0.2.2:5173/'), 'http://10.0.2.2:5173/me/pay')
  assert.equal(webUrl('/me/profile?focus=withdrawal', 'https://storyfork.example/app'), 'https://storyfork.example/me/profile?focus=withdrawal')
})
