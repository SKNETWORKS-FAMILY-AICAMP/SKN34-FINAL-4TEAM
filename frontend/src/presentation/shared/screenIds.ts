import { useEffect } from 'react'

import { useAppDispatch } from '../../app/store'
import { sessionActions } from './session/sessionSlice'

/** 목업 SID: 화면 ID와 이름 (docs/prototype-alignment.md 2절의 키) */
export const SID: Record<string, string> = {
  U01: '홈', U02: '홈 · 필터 결과', U03: '빠른 이동 (Ctrl K)', U04: '소설 상세', U05: '회차 뷰어', U06: '댓글·피드백·신고',
  U07: '보기 설정 (Aa)', U08: '회차 끝 · 포크·댓글', U09: '포크 (3단계 폼)', U10: '포크 생성 완료 · 스냅샷', U11: '내 서재',
  U12: '내 서재 · 내가 쓰는 소설', U13: '집필실', U14: '집필실 · AI 도움', U15: '인물에게 맡겨 보기 (바텀시트)', U16: 'AI 소설 제안',
  U17: '설정 검사 · 수정', U18: '집필실 · 타임라인', U19: '집필실 · 설정 노트', U20: '독자 피드백함', U21: '소설 공개 설정',
  U22: '회차 공개', U23: '크레딧·이용 정책 안내 (P2)', U24: '소설 가져오기', U25: '랭킹', U26: '포크 소설 모아보기', U27: '캐릭터 챗',
  U30: '계정 · 프로필·회원탈퇴', U31: '계정 · 회원가입', U32: '계정 · 관심 소설', U33: '계정 · 결제 내역', U34: '계정 · 문의하기',
  U35: '계정 · 공지사항', U35E: '계정 · 이벤트', U36: '검색 결과', U37: '집필실 · 보드', U38: '집필실 · 사전 (세계관·캐릭터)',
  U39: '집필실 · 개요', U40: '집필실 · 서술', U41: '집필실 · 메모', U29: '해시태그 모아보기', U28: '새 소설 만들기', U42: '알림함',
  L01: '로그인 (회원·관리자 선택)', A01: '관리자 · 운영 개요', A02: '관리자 · 데이터 전처리', A03: '관리자 · 권리·신고 목록',
  A04: '관리자 · 신고 상세·조치', A05: '관리자 · LLM Ops', A06: '관리자 · 원작/포크 격리 점검', U43: '집필 방식·저작권 안내',
  A07: '관리자 · 사용자', A08: '관리자 · 작품', A09: '관리자 · 댓글', A10: '관리자 · 제보·문의', A11: '관리자 · 이벤트',
  A12: '관리자 · 공지', A13: '관리자 · 크레딧', A14: '관리자 · 활동 로그', A15: '관리자 · 프로필', A16: '관리자 · 정기 작업',
  A18: '관리자 · 캐릭터챗',
}

export const screenLabel = (id: string) => id.split('+').map((x) => x + ' ' + SID[x]).join('  ·  ')

/** 페이지가 렌더링될 때 화면 ID를 기록합니다 (목업 baseId·setId). null이면 이전 ID를 둡니다. */
export function useScreenId(id: string | null) {
  const dispatch = useAppDispatch()
  useEffect(() => { if (id) dispatch(sessionActions.setBaseScreen(id)) }, [dispatch, id])
}
