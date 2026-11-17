/**
 * 표지 규칙 하나(#432): 올린 표지가 있으면 그 표지, 없으면 기본 표지. 테마·장르 SVG(`Art`)는 표지 대신 쓰지 않는다.
 * `uploaded`는 이미 쓸 수 있는 주소(공개 cover 주소·객체 주소·데모 data URL)이고 표지가 없으면 비어 있다.
 */
export const DEFAULT_COVER = '/default-work-cover.svg'
export const coverSrc = (uploaded?: string | null) => uploaded || DEFAULT_COVER
