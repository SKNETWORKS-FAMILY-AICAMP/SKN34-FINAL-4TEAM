# 폐기된 Content 확장안 보관

이 디렉터리는 실행 경로가 아니다. `.sql.txt`는 이전 V1/V2의 원본 바이트를 보존한 검토 기록이며 Flyway location에 포함하지 않는다. 새 독립 V1과 혼용하거나 repair로 교체하지 않는다.

원본: `world-studio-ux` worktree의 `db/migration/worldstudio`. 원본 worktree는 변경하지 않았다.

| 파일 | SHA-256 |
|---|---|
| V1__initial_world_schema.sql.txt | 8ff87f008caba53efb88f4085bcbe79c1ea0c02f7168c6fa79a2a576da0bd4a0 |
| V2__protect_world_revision.sql.txt | 3afedfc4778bd4fb0ec51bc15c26ee1e6c715293610867ee67a4da9bbf88399e |

공용 DB의 실제 적용 여부는 확인하지 못했다. 기존 읽기 시도는 인증 실패였고 migration·repair·baseline·데이터 변경은 수행하지 않았다. 적용된 DB라면 새 독립 V1을 덮어 적용할 수 없으며 별도 전환 설계가 필요하다.

이전 로컬 테스트 결과는 새 독립 스키마의 검증 결과가 아니다. 기존 실험용 설정·테스트 원문은 로컬 `output/superseded-source/`에 보존했다.
