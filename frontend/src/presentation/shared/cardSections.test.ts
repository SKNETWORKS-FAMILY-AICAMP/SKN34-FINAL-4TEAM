import { describe, expect, it } from 'vitest'

import { plainCardText, splitCardSections } from './cardSections'

describe('splitCardSections', () => {
  it('## 줄이 없으면 본문 전체가 개요 한 문단이다', () => {
    expect(splitCardSections('달을 끄는 신.\n\n물때를 다스린다.')).toEqual([{ title: '개요', body: '달을 끄는 신.\n\n물때를 다스린다.' }])
  })

  it('## 제목 줄마다 문단을 나누고 첫 ## 앞의 내용은 개요가 된다', () => {
    expect(splitCardSections('소개 한 줄\n\n## 성격\n차분하다.\n\n## 과거\n- 항해사\n- 실종')).toEqual([
      { title: '개요', body: '소개 한 줄' },
      { title: '성격', body: '차분하다.' },
      { title: '과거', body: '- 항해사\n- 실종' },
    ])
  })

  it('첫 줄이 ##이면 앞 개요 없이 그 제목의 문단부터 시작한다', () => {
    expect(splitCardSections('## 성격\n차분하다.')).toEqual([{ title: '성격', body: '차분하다.' }])
  })

  it('코드 블록 안의 ##은 문단을 나누지 않는다', () => {
    const text = '소개\n\n```md\n## 코드 속 제목\n```\n\n~~~\n## 물결 울타리 속 제목\n~~~\n\n## 진짜 제목\n내용'
    expect(splitCardSections(text)).toEqual([
      { title: '개요', body: '소개\n\n```md\n## 코드 속 제목\n```\n\n~~~\n## 물결 울타리 속 제목\n~~~' },
      { title: '진짜 제목', body: '내용' },
    ])
  })

  it('닫히지 않은 코드 블록은 끝까지 코드이고 더 긴 울타리만 그것을 닫는다', () => {
    expect(splitCardSections('````\n```\n## 아직 코드\n````\n## 제목\n내용')).toEqual([
      { title: '개요', body: '````\n```\n## 아직 코드\n````' },
      { title: '제목', body: '내용' },
    ])
    expect(splitCardSections('```\n## 끝까지 코드')).toEqual([{ title: '개요', body: '```\n## 끝까지 코드' }])
  })

  it('본문이 비었거나 공백뿐인 문단은 뺀다', () => {
    expect(splitCardSections('')).toEqual([])
    expect(splitCardSections('  \n\n ')).toEqual([])
    expect(splitCardSections('## 빈 문단\n\n## 채운 문단\n내용\n## 또 빈 문단\n  \n')).toEqual([{ title: '채운 문단', body: '내용' }])
  })

  it('제목 앞뒤 공백을 다듬고 #·###은 나누는 줄로 보지 않는다', () => {
    expect(splitCardSections('# 큰 제목\n본문\n### 작은 제목\n본문2\n##제목 아님\n   ##   공백 제목   \n내용')).toEqual([
      { title: '개요', body: '# 큰 제목\n본문\n### 작은 제목\n본문2\n##제목 아님' },
      { title: '공백 제목', body: '내용' },
    ])
  })

  it('윈도 줄바꿈(CRLF)도 같게 나눈다', () => {
    expect(splitCardSections('소개\r\n## 성격\r\n차분하다.')).toEqual([{ title: '개요', body: '소개' }, { title: '성격', body: '차분하다.' }])
  })
})

describe('plainCardText', () => {
  it('굵게·기울임·취소선·코드 기호를 벗기고 글자는 남긴다', () => {
    expect(plainCardText('**성격**: *차분함* · ~~거짓~~ · __또 굵게__ · _또 기울임_ · `코드`')).toBe('성격: 차분함 · 거짓 · 또 굵게 · 또 기울임 · 코드')
  })

  it('제목·목록·인용·구분선 기호를 벗기고 줄은 한 줄로 이어 붙인다', () => {
    expect(plainCardText('#### 1. 무협 — 《소공자》\n\n**한 줄 소개**  \n멸문의 날로 돌아온다.\n\n- **주인공:** 남궁현\n1. 첫째\n2) 둘째\n> 인용\n---\n끝')).toBe('1. 무협 — 《소공자》 한 줄 소개 멸문의 날로 돌아온다. 주인공: 남궁현 첫째 둘째 인용 끝')
  })

  it('링크는 글자만, 이미지는 대체 글자만 남긴다', () => {
    expect(plainCardText('[달무리 군도](https://example.test/a)와 ![지도](https://example.test/m.png) 그리고 ![](https://example.test/x.png)')).toBe('달무리 군도와 지도 그리고')
  })

  it('코드 울타리 줄과 표의 구분 줄·세로선을 지운다', () => {
    expect(plainCardText('```js\nconst a = 1\n```\n| 이름 | 나이 |\n| --- | :-: |\n| 하린 | 19 |')).toBe('const a = 1 이름 나이 하린 19')
  })

  it('기호가 아닌 글자는 건드리지 않는다', () => {
    expect(plainCardText('2 * 3 = 6, snake_case_name, 1~3화, a|b, 100%')).toBe('2 * 3 = 6, snake_case_name, 1~3화, a|b, 100%')
    expect(plainCardText('  달을 끄는\n\n신  ')).toBe('달을 끄는 신')
    expect(plainCardText('')).toBe('')
  })
})
