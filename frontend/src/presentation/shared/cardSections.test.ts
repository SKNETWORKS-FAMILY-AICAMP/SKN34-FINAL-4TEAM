import { describe, expect, it } from 'vitest'

import { numberCardSections, plainCardText, splitCardSections } from './cardSections'

describe('splitCardSections', () => {
  it('제목 줄이 없으면 본문 전체가 제목 없는(빈 제목, 단계 0) 첫머리 한 문단이다', () => {
    expect(splitCardSections('달을 끄는 신.\n\n물때를 다스린다.')).toEqual([{ title: '', body: '달을 끄는 신.\n\n물때를 다스린다.', level: 0 }])
  })

  it('마크다운 제목 #·##·### 줄마다 문단을 나누고 단계를 남기며 첫 제목 앞의 내용은 제목 없는 첫머리다(개요를 지어 붙이지 않는다)', () => {
    expect(splitCardSections('소개 한 줄\n\n# 인물\n사람들.\n## 성격\n차분하다.\n### 말버릇\n- 음\n## 과거\n- 항해사')).toEqual([
      { title: '', body: '소개 한 줄', level: 0 },
      { title: '인물', body: '사람들.', level: 1 },
      { title: '성격', body: '차분하다.', level: 2 },
      { title: '말버릇', body: '- 음', level: 3 },
      { title: '과거', body: '- 항해사', level: 2 },
    ])
  })

  it('첫 줄이 제목이면 첫머리 문단 없이 그 제목의 문단부터 시작한다', () => {
    expect(splitCardSections('## 성격\n차분하다.')).toEqual([{ title: '성격', body: '차분하다.', level: 2 }])
  })

  it('코드 블록 안의 제목 줄은 문단을 나누지 않는다', () => {
    const text = '소개\n\n```md\n## 코드 속 제목\n```\n\n~~~\n# 물결 울타리 속 제목\n~~~\n\n## 진짜 제목\n내용'
    expect(splitCardSections(text)).toEqual([
      { title: '', body: '소개\n\n```md\n## 코드 속 제목\n```\n\n~~~\n# 물결 울타리 속 제목\n~~~', level: 0 },
      { title: '진짜 제목', body: '내용', level: 2 },
    ])
  })

  it('닫히지 않은 코드 블록은 끝까지 코드이고 더 긴 울타리만 그것을 닫는다', () => {
    expect(splitCardSections('````\n```\n## 아직 코드\n````\n## 제목\n내용')).toEqual([
      { title: '', body: '````\n```\n## 아직 코드\n````', level: 0 },
      { title: '제목', body: '내용', level: 2 },
    ])
    expect(splitCardSections('```\n## 끝까지 코드')).toEqual([{ title: '', body: '```\n## 끝까지 코드', level: 0 }])
  })

  it('본문이 빈 문단은 빼되 바로 아래 단계 제목이 이어지는 빈 상위 제목은 남긴다', () => {
    expect(splitCardSections('')).toEqual([])
    expect(splitCardSections('  \n\n ')).toEqual([])
    expect(splitCardSections('## 빈 문단\n\n## 채운 문단\n내용\n## 또 빈 문단\n  \n')).toEqual([{ title: '채운 문단', body: '내용', level: 2 }])
    expect(splitCardSections('# 인물\n## 성격\n차분하다.')).toEqual([{ title: '인물', body: '', level: 1 }, { title: '성격', body: '차분하다.', level: 2 }])
  })

  it('#### 이하 제목은 문단을 나누지 않고 그 문단 본문에 남는다(목차는 ###까지)', () => {
    expect(splitCardSections('### 과거\n#### 어린 시절\n온실에서 자랐다.')).toEqual([{ title: '과거', body: '#### 어린 시절\n온실에서 자랐다.', level: 3 }])
  })

  it('제목 앞뒤 공백과 닫는 #을 다듬고 #과 제목 사이에 공백이 없는 줄은 제목이 아니다', () => {
    expect(splitCardSections('##제목 아님\n####### 일곱 개\n   ##   공백 제목  ##  \n내용')).toEqual([
      { title: '', body: '##제목 아님\n####### 일곱 개', level: 0 },
      { title: '공백 제목', body: '내용', level: 2 },
    ])
  })

  it('윈도 줄바꿈(CRLF)도 같게 나눈다', () => {
    expect(splitCardSections('소개\r\n## 성격\r\n차분하다.')).toEqual([{ title: '', body: '소개', level: 0 }, { title: '성격', body: '차분하다.', level: 2 }])
  })
})

describe('numberCardSections', () => {
  const at = (...levels: number[]) => numberCardSections(levels.map((level) => ({ title: 't', body: 'b', level }))).map(({ no, depth }) => [no, depth])
  it('단계에 따라 1 · 1.1 · 1.1.1처럼 겹쳐 번호를 매긴다', () => {
    expect(at(1, 2, 3, 2, 1)).toEqual([['1', 1], ['1.1', 2], ['1.1.1', 3], ['1.2', 2], ['2', 1]])
  })
  it('#로 시작하지 않아도 가장 얕은 제목이 1단계이고, 건너뛴 단계는 한 단계로 친다', () => {
    expect(at(1, 3, 1)).toEqual([['1', 1], ['1.1', 2], ['2', 1]])
    expect(at(3, 1)).toEqual([['1', 1], ['2', 1]])
    expect(at(1, 3, 2)).toEqual([['1', 1], ['1.1', 2], ['1.2', 2]])
  })
  it('첫머리(단계 0)는 번호 없이 뺀다', () => {
    expect(numberCardSections([{ title: '', body: '소개', level: 0 }, { title: '성격', body: 'b', level: 2 }]).map((s) => s.no)).toEqual(['1'])
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
