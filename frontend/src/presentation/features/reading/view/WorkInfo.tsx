import type { ReactNode } from 'react'

import type { Work } from '../../../../domain/entities/work'
import { ago } from '../../../shared/format'
import { Go } from '../../../shared/Go'

const DAYS = ['월', '화', '수', '목', '금', '토', '일']

/**
 * 연재 요일 표시. 새 소설 만들기는 '월요일'처럼 전체 이름으로 저장하므로 첫 글자로 맞춥니다.
 * 비어 있거나 알아볼 수 없으면 서버·작품이 주기를 주지 않은 것이므로 null이고, 상세 정보에서는 그 행을 감춥니다.
 */
export function scheduleLabel(schedule?: string[]) {
  if (!schedule?.length) return null
  if (schedule.includes('비정기')) return '비정기 연재'
  const days = DAYS.filter((d) => schedule.some((s) => s.startsWith(d)))
  if (!days.length) return null
  if (days.length === 7) return '매일 연재'
  if (days.join('') === '월화수목금') return '월~금 연재'
  return `${days.join('·')} 연재`
}

// ponytail: 연재 상태는 프론트 데모 표시뿐이다. 서버 작품은 값이 없어 상세 정보에서 그 행을 감춘다. 백엔드 연결 시 Content 작품 응답에 필드를 추가한다.
/** 연재 상태·요일 표시 규칙. 완결은 요일을 감추고 '완결'만 보이며, 상태가 없으면(서버 작품) 상태 배지도 없다. 값이 없는 행은 null이다. */
export function serialView(w: Pick<Work, 'serial' | 'schedule'>) {
  const days = scheduleLabel(w.schedule)
  const done = w.serial === '완결'
  return { badge: w.serial ?? null, days: done ? null : days, scheduleRow: done ? '완결' : days, statusRow: w.serial ?? null }
}

// ponytail: 작품 정보 탭 데모. 연재 주기·연령등급은 메모리 작품에만 있고 서버 작품은 값이 없어 그 행을 감춘다. 백엔드 연결 시 Content 작품 응답에 필드를 추가한다.
/** parent는 화면이 읽어 온 원작이다. 원작을 열 수 없으면(삭제·비공개) 링크 없이 제목만 보입니다. */
export function WorkInfo({ work: w, parent, episodeCount }: { work: Work; parent?: Work; episodeCount: number }) {
  const sv = serialView(w)
  const sourceTitle = parent?.title ?? w.parentTitle
  const rows: [string, ReactNode][] = [
    ['글', w.author],
    ['장르', w.genre],
    ['연재 상태', sv.statusRow],
    ['연재', sv.scheduleRow],
    ['연령 등급', w.rating ? (w.rating === '성인' ? '19세 이용가' : '전체 이용가') : null],
    ['창작 유형', w.parent || w.parentTitle ? '포크 소설' : w.kind],
    ['총 회차', `${episodeCount}화`],
  ]
  if (w.statisticsSupported !== false) rows.push(['최근 업데이트', ago(w.upd)])
  if (w.parent || w.parentTitle) rows.push(['원작', parent ? <Go key="src" to={`/work/${parent.id}`}>「{sourceTitle}」 {w.forkAt}화에서 분기</Go> : `「${sourceTitle}」 ${w.forkAt}화에서 분기`])
  return (
    <div className="winfo">
      <section aria-labelledby="wi-sum">
        <h2 id="wi-sum">작품 소개</h2>
        {w.hook && <p className="wi-hook">“{w.hook}”</p>}
        <p className="wi-body">{w.summary || '아직 작품 소개가 없어요.'}</p>
      </section>
      {!!w.hash?.length && (
        <section aria-labelledby="wi-kw">
          <h2 id="wi-kw">키워드</h2>
          <div className="hashes">{w.hash.map((h) => <Go key={h} to={`/tag/${encodeURIComponent(h.replace(/^#/, ''))}`}>{h}</Go>)}</div>
        </section>
      )}
      <section aria-labelledby="wi-detail">
        <h2 id="wi-detail">상세 정보</h2>
        <dl className="wi-dl">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>
    </div>
  )
}
