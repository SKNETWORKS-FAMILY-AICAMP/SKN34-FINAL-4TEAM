import type { ReactNode } from 'react'
import type { ImportWorldBuild } from '../../domain/entities/manuscript'

/** 업로드(등록·저장) 버튼 곁의 안내 한 줄. 확인 체크·확인창 없이 OpenAI 전송만 알린다(initial-build-storage-contract의 업로드 자동 시작). */
export function ImportUploadNotice() {
  return <p className="small muted">세계관을 처음 만들 때는 업로드한 원고가 자동 추출을 위해 OpenAI로 전송돼요.</p>
}

/**
 * 가져오기 응답의 세계관 추출 접수 결과다. 접수·발행 안내는 role="status"로, 접수 거절은 추출 시작 실패와 서버 사유를 role="alert"로 알린다.
 * null(회차를 저장하지 않아 접수하지 않음)이면 아무것도 그리지 않는다. 세계관 탭으로 가는 수단은 화면마다 달라 children으로 받는다.
 */
export function ImportWorldBuildResult({ worldBuild, className, children }: { worldBuild: ImportWorldBuild | null; className?: string; children?: ReactNode }) {
  if (!worldBuild) return null
  if (worldBuild.code === 'WORLD_UPDATE_ON_PUBLISH' && worldBuild.message)
    return <p role="status" className={className}>{worldBuild.message}</p>
  if (worldBuild.status === 'rejected') {
    return <p role="alert" className={className}>
      세계관 추출을 시작하지 못했어요.{worldBuild.message && ` ${worldBuild.message}`}
    </p>
  }
  return <p role="status" className={className}>세계관 추출을 시작했어요. 작품 관리 &gt; 세계관에서 진행을 볼 수 있어요. {children}</p>
}
