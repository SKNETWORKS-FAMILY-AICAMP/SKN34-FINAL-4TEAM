import { useId } from 'react'

/**
 * 표지 'AI로 생성' 자리. 보조 버튼 크기는 '이미지 선택'과 같고, 아직 연결되지 않아 비활성이며 '준비 중'을 보이는 글자로 알린다
 * (툴팁이 아니라 aria-describedby로 이어서 스크린리더도 읽는다). API는 부르지 않는다.
 * ponytail: AI 표지 생성 API 연결은 후속. 연결하면 disabled와 '준비 중' 글자를 걷고 생성 요청·결과 미리보기를 붙인다.
 */
export function AiCoverButton() {
  const note = useId()
  return (
    <span className='ep-cover-ai'>
      <button type='button' className='btn sm' disabled aria-describedby={note}><span aria-hidden='true'>✦</span> AI로 생성</button>
      <span id={note} className='small muted'>준비 중</span>
    </span>
  )
}
