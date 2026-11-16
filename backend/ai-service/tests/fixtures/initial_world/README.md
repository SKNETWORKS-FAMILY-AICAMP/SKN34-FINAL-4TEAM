# #219 공유 계약 자료

출처: PR #219 commit `6c5ed7d86081fa642c57b440f580bfbf3d143057`, `docs/design/initial-world-preprocessing/`.
두 JSON은 원본 바이트 고정본이다. 관련 Input/Output DTO만 production으로 재사용했으며 테스트 전용 Contract나 저장 DTO를 import하지 않는다.
정식 계약 변경 시 고정본과 DTO/호환 테스트를 함께 검토한다. 실행 중 GitHub나 모델을 호출하지 않는다.

- `contract.schema.json` SHA-256: `248cf0b349a34a775819db74685d91b38b28c66f37d2bc93218bb07c3d60dacd`
- `honggildong.json` SHA-256: `13b4358cf20427e896a4c144b0fa4667cee74fd746824a7187c298970daf407e`
