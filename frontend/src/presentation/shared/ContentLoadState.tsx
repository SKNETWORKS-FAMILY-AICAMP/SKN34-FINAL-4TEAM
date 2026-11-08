/** API 읽기의 로딩·실패를 빈 목록이나 샘플 성공으로 숨기지 않습니다. */
export function ContentLoadState({failed,retry}:{failed:boolean;retry:()=>void}) {
  return <div className="panel" role={failed?'alert':'status'}>
    <p>{failed?'소설을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.':'소설을 불러오고 있어요…'}</p>
    {failed && <button type="button" className="btn" onClick={retry}>다시 불러오기</button>}
  </div>
}
