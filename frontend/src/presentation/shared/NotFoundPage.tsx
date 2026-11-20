import { Go } from './Go'
import { Footer, Gnb } from './shell/Gnb'
import { useDocumentTitle } from './useDocumentTitle'

/** 어떤 화면에도 맞지 않는 주소. 주소는 그대로 두고 홈·탐색으로 가는 길만 안내한다. */
export function NotFoundPage() {
  useDocumentTitle('페이지를 찾을 수 없어요')
  return (
    <>
      <Gnb />
      <main className="wrap" id="main" tabIndex={-1}>
        <div className="panel">
          <h1>페이지를 찾을 수 없어요</h1>
          <p className="muted">주소가 바뀌었거나 삭제된 페이지예요.</p>
          <div className="acts" style={{ marginTop: 20 }}>
            <Go to="/" className="btn pri">홈으로</Go>
            <Go to="/search" className="btn">작품 둘러보기</Go>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
