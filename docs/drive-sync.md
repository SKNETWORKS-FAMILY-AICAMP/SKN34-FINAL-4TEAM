# 산출물 Google Drive 동기화

`docs/`의 다음 네 파일만 원본 형식으로 동기화합니다.

- `SKN34-final-4Team.hwpx`
- `SKN34-final-4Team_WBS.xlsx`
- `SKN34-final-4Team_요구사항정의서.xlsx` (한글 NFC/NFD 모두 인식)
- `SKN34-final-4Team.pdf`

`develop`에 해당 파일 변경이 반영되면 실행합니다. Actions의 **Artifact Drive sync → Run workflow**로 `main` 또는 `develop`에서 수동 실행할 수도 있습니다. 워크플로는 먼저 기본 브랜치에 등록되어야 수동 실행 UI가 표시됩니다. 네 파일 모두 Git에 등록되어 있어야 하며 로컬 미등록 파일은 Actions에서 사용할 수 없습니다.

대상 폴더: https://drive.google.com/drive/folders/1R7MtN36qkHy2IoOobcE4-bo0HeOzKlQa

## 인증 설정

Repository Actions Secrets: `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN`.
Actions Variable: `GDRIVE_FOLDER_ID`.
OAuth 계정에 폴더 추가 권한과 기존 파일 수정 권한이 필요합니다. Drive API를 활성화하고 읽기·쓰기 권한을 승인한 사용자 refresh token을 사용합니다. 외부 OAuth 앱의 Testing 상태에서는 Drive 범위 refresh token이 보통 7일 후 만료하므로 장기 실행에 적합한 게시 상태를 확인하세요. 비밀값은 Git·로그·채팅에 넣지 않습니다.

## 덮어쓰기 정책

- 지정 폴더 바로 아래의 같은 이름을 찾아 업데이트하며 기존 파일 ID·링크를 유지합니다. 최초 실행부터 동명 일반 파일 내용을 교체하므로 폴더를 먼저 확인하세요.
- 동일 MD5는 생략하고 새 파일만 생성합니다. 업로드 응답 MD5도 확인합니다.
- 중복 이름·Google Docs/Sheets 변환본·편집 불가 파일은 실패 처리합니다. 하위 폴더를 검색하거나 이동하지 않습니다.
- 삭제·이름 변경 시 기존 Drive 파일은 보존합니다. 지정 대상이 로컬에 없으면 전체 사전 검증이 실패하여 업로드하지 않습니다.
- 업로드 중 실패하면 앞서 성공한 파일은 유지됩니다. 다중 파일 트랜잭션은 아니며 재실행 시 일치한 내용은 생략합니다.
- PR에서는 비밀값 없이 회귀 테스트만 실행합니다. 자동 동기화와 수동 실행은 동시 실행되지 않습니다.

## 로컬 확인

```bash
python3 infrastructure/scripts/test-drive-sync.py
python3 infrastructure/scripts/drive-sync.py --check
```

Python 표준 라이브러리만 사용합니다. 로컬 확인은 OAuth 인증·실제 Drive 업로드 성공을 증명하지 않습니다. 최초 Actions 실행 로그의 파일 ID와 생성·업데이트·생략 결과를 확인하고 Drive에서 원본을 확인하세요.
