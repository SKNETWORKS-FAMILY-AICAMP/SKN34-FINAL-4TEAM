/** 공개 연결 확인 결과. HTTP 응답의 런타임 검증은 Data에서 담당합니다. */
export type CoreApiHealth = {
  status: string
  service: string
}
