/**
 * 카드 분류 목록(`useCardCategories`)을 쓸 수 없을 때의 안내: 읽지 못했으면 실패와 다시 시도(장르 목록 실패 안내와 같은 모양)를, `isLoading`을 주면 읽는 동안의 글을 보인다.
 * 이름만 보이는 화면은 `isLoading`을 주지 않는다(화면에 들어올 때마다 잠깐 깜빡이는 글을 만들지 않는다). 목록이 있으면 아무것도 그리지 않는다.
 */
export function CardCategoryNotice({ isLoading = false, isError, retry }: { isLoading?: boolean; isError: boolean; retry: () => void }) {
  if (isError) return <p role="alert" className="world-notice"><span>카드 분류를 불러오지 못했어요.</span><button type="button" className="btn sm" onClick={retry}>다시 시도</button></p>
  return isLoading ? <p className="small muted">카드 분류를 불러오고 있어요.</p> : null
}
