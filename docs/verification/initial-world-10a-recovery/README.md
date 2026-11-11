# 10-A 확정 복구 증분 통합 · 최종 팀 리뷰

## 고정 기준

- 보존한 성공 통합: `test/initial-world-integration-refresh` / `efeebdf153b7c18976575c10227b088b28d5773b`.
- 새 검증 브랜치: `test/initial-world-recovery-integration`.
- 최신 develop: `31ac64d57541e203a2f31ef39eacf10248f6bc8d`. 이전 `27d4b01f` 이후 #295 작품 공지·댓글·조회 권한과 DI/기능표 변경을 그대로 결합했다.
- #288 `6abb5ab1 → bae2eca5`의 7파일 diff만 `fec06de0`으로 적용. 전체 선행 브랜치 재병합 없음.
- 런타임 통합 커밋: `a231930d7c2904f1780f7abe03308689b18401f2`. 이후 이 증거 문서만 추가한 HEAD에서 전체 CI 실행.
- #289 원본 `58265ebf659e04492536b344b5c9e4a934d6029f` 및 다른 Draft PR 원본 브랜치는 수정하지 않았다.

## 보존 검사

지정 #288 증분의 stable patch-id와 실제 적용 커밋이 동일하다. 최신 develop delta와 통합 merge delta도 동일하다. 수동 충돌 해결/런타임 추가 수정은 없다. 기존 DI의 initialWorld/creditLedger와 신규 workNotice 등록이 함께 유지된다.

#289 고유 7파일은 원래 통합본의 구현·테스트·계약을 보존한다. 기능표는 기존 #289 행과 #288/팀원 행을 함께 보존한다. Context 구현 및 테스트 6파일의 Git blob이 기존 성공 통합본과 동일하다. V1~V5 Git blob SHA256은 최초 manifest와 동일하며 이전 검증 문서도 변경하지 않았다. Content 신규 V36은 팀원 #295 소유로 유지하며 WorldStudio의 별도 V1~V5와 혼합하지 않는다.

## PR별 최종 리뷰

전체 OPEN/Draft, 개별 기존 HEAD Required CI 성공. 정확한 base SHA/CI 링크/변경 소유 기준은 manifest.json에 기록한다. GitHub MERGEABLE은 현재 base 기준일 뿐, 선행 PR 병합 후의 새 develop과 충돌 없음을 보장하지 않는다. UNKNOWN은 GitHub 재계산 상태이며 최종 보고에서 재확인한다.

| PR | 최신 HEAD | 현재 base | 증분 소유 범위 | 현재 base 충돌 | 팀 리뷰 | 병합 후 배포 QA |
|---|---|---|---|---|---|---|
| #219 | `6c5ed7d86081fa642c57b440f580bfbf3d143057` | `develop` | 계약·Schema·Fixture | UNKNOWN | 출처 식별·UTF-16·동일 후보 다중 결정 이력 | 실제 요청 계약 오류 안내 |
| #225 | `3bf930157b462b91a5593e9831b9053e9676d400` | `develop` | 분석/후보/검토/예약 PostgreSQL | UNKNOWN | 기존 migration 불변·신규/순차 업그레이드 | 실제 schema history/checksum 확인, repair 금지 |
| #235 | `0f5d4efd9dad31e777f37ff103c20913e744f7d2` | `develop` | 저장 초안 스냅샷 | UNKNOWN | 소유권·ID·기준 revision·원문 해시 | 권한·stale 및 관계 미완료 차단 |
| #262 | `90568cfda520be91a9c5da7fad936fbadf9281eb` | `develop` | AI 내부 추출 | UNKNOWN | 7종 의미·근거·UUID 검증; 유료 호출 미실행 | 별도 승인된 모델 품질 평가 |
| #266 | `3c3772924bf18c50e27e5020a723c223ac5332ee` | `feat/initial-world-5c-dependencies` | 분석 실행·후보 영속화 | MERGEABLE | dependencies 브랜치 자체 병합 금지; 선행 4개 후 develop base 전환 | timeout/재시작/중복 key/분석 재조회 |
| #270 | `0192047b1b91e6f70e2cb5c397d00ba6da67cd0b` | `feat/initial-world-analysis-execution` | 후보 결정 저장 | MERGEABLE | 수정 후 pending·재승인·순번·멱등성 | 재로그인 후 검토 이력/권한 |
| #284 | `cf3289346a74fae5c97b3ebba5a9dc51e87f9b01` | `feat/initial-world-candidate-decisions` | 승인 후보 초안 반영 | MERGEABLE | Neo4j/PG 부분 실패·동일 key/UUID 복구·receipt | 응답 유실/unknown 복구, 실제 사용자 데이터 변경 없이 QA |
| #285 | `23c60ed8e4291a94c4be5329b0774f0d5294e26e` | `feat/initial-world-approved-application` | metadata 왕복 | MERGEABLE | AI 근거·provenance·기존 ID·관계 보존 | 저장/재조회/재저장 비교 |
| #286 | `354555b5e166f98768afb017640c56ed4f1e9060` | `fix/initial-world-metadata-roundtrip` | AI 검토 UI | MERGEABLE | 승인과 반영 구분·미확인 요청 보호 | 모바일/키보드/재로그인 |
| #288 | `bae2eca5a289956acca0b7b7e997b36dbb77d8ae` | `feat/initial-world-review-ui` | 확정 UI + 복구 증분 7파일 | MERGEABLE | 원래 확정 성공과 현재 최신 버전 분리; 명시 확인 전 key 보존; 확인 POST 금지 | 실제 브라우저 다중 탭·응답 유실·새로고침·재로그인 |
| #289 | `58265ebf659e04492536b344b5c9e4a934d6029f` | `feat/worldstudio-revision-ui` | 읽기 전용 확정 Context 고유 7파일 | MERGEABLE | 지정 확정본만; 초안/미승인 후보/과거 관계 미혼입 | 소유자 권한·이전 버전 불변; 팀원 Context 소비는 별도 |

## 순차 병합 절차 및 예상 장애

순서: #219 → #225 → #235 → #262 → #266 → #270 → #284 → #285 → #286 → #288 → #289.

1. 선행 PR이 실제 병합됐는지 확인하고 새 develop/다음 HEAD를 고정한다.
2. 최초 manifest의 owned diff와 현행 PR diff를 대조한다. squash 이력에서는 ancestry만 보고 중복 변경을 다시 적용하지 않는다.
3. #266의 검증 전용 dependencies 브랜치는 develop에 병합하지 않는다. 선행 4개가 반영된 후 #266 base를 develop으로 전환하고 실행 관리 증분만 남는지 확인한다.
4. 각 stacked PR은 선행 반영 후 base를 develop으로 전환하고 필요하면 정상 merge commit으로 최신화한다. force push/전체 통합본 병합은 하지 않는다.
5. DI·roadmap 및 develop에서 이미 추가된 버전 목록 API는 팀원 구현을 보존한다. 과거 계약/선행 코드를 통째로 다시 넣으면 중복 충돌이 생긴다. 이번 증분 통합 자체는 무충돌이다.
6. 각 새 HEAD의 Required CI·증분 diff·팀 리뷰를 재확인한 뒤 별도 사람 승인으로 다음 순서를 진행한다. 이번 작업은 병합하지 않는다.

#289는 이번 통합에서 최신 #288과 함께 검증하지만 원본 PR HEAD는 이전 기반이다. 원본을 갱신할 경우 정상 merge로 #288 HEAD만 반영하면 되고, #288 대비 #289 고유 7파일/132줄이 유지되는지 재검증해야 한다. 이 방식은 원본 이력을 보존하지만 HEAD/CI가 바뀐다. 이번에는 원본을 변경하지 않았으며 향후 변경 전에 방식·영향을 보고한다.

## 필수 검증 및 한계

workflow_dispatch는 모든 서비스와 HTTP 시나리오를 선택한다. 최종 실행 HEAD와 run URL/결과는 완료 보고에 고정한다. 아직 실행하지 않은 검증을 성공으로 표시하지 않는다.

- #288 Hook 17개 + 화면 1개: 원래 확정 성공/후속 포인터 분리, 확인 전 key 유지, 확인 POST 금지, 새 확정 시작, 불일치/응답 유실/재로그인/중복 클릭/탭 잠금 대역.
- 프런트 단위·React 전체, AI 단위·HTTP, Content PostgreSQL/Neo4j, 전체 HTTP 시스템, WorldStudio 신규/순차 업그레이드/재실행 및 기존 데이터 보존.
- #289 지정 확정본 원문/ID/metadata 재현, 이후 초안·미승인 후보 격리, 소유권, 과거 관계 미포함, 이전 확정 불변.
- 제공사/AI 대역 기반 계층별 성공 경로와 격리 실제 HTTP 시나리오를 구분한다. 실제 유료 모델 호출·품질 평가 및 실제 배포 단일 모델 E2E는 하지 않는다.
- 실제 배포의 인증/CSRF/proxy, 모바일/키보드/다중 탭, 응답 유실·재로그인·재시작은 별도 QA 세계관으로 점검한다. 기존 사용자 데이터/개발·운영 DB는 건드리지 않는다.
- #289는 확정 설정 Context 조각이며 전체 집필 Context Builder·작품/회차 연결·지식 필터·MCP·Fork·과거 관계 복원을 제공하지 않는다.

## 추가 develop 최신화 · 63e5618d

위 31ac64d5 기준 통합 `3c90dd0f5c3f8773adca771b15b5b41215a8c95d`는 CI 42978541917의 모든 job/Required CI 성공으로 보존한다. 프런트 단위 1,025개, React 통합 1,097개(#288 Hook 17/화면 1 포함), AI, Content PG/Neo4j, 마이그레이션, HTTP 시스템이 통과했다.

완료 재확인 시 develop이 `63e5618d6022d362bc206bb99607a0b3a85158d1`로 변경되어 추가 반영했다. #290 알림 상세/묶음 조회 및 #294 회원 탈퇴 완료 기능의 Core 17파일 변경이다. 기본 비활성 탈퇴 작업 설정을 바꾸지 않는다. 새 런타임 통합 `2968932e72b641b56577f4baaeac59d77adf1662`는 원본 Core delta와 동일한 patch-id이며 프런트/Content/AI 파일은 직전 성공 통합과 동일하다. 텍스트 충돌 없음. 이 문서 갱신을 포함한 새 HEAD에서 전체 CI를 다시 실행한다.

PR별 GitHub 재계산 후 11개 모두 현재 base 기준 MERGEABLE/CLEAN 및 Draft/OPEN임을 확인했다. 최초 manifest의 UNKNOWN은 조회 시 재계산 중이었던 기록이다. #289와 기존 통합 원본은 여전히 변경하지 않았다.
