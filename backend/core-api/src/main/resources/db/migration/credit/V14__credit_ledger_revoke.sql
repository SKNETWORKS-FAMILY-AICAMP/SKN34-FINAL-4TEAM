-- 운영자 수동 회수(DEC-57)는 장부에 kind 'revoke'로 남긴다(사용 'spend'와 구분). V12의 장부 kind CHECK(자동 이름 credit_ledger_entry_kind_check)를 넓힌다.
-- 지급 종류 'operator'는 credit_grant.kind에 CHECK가 없어 바꿀 것이 없다.
ALTER TABLE credit_ledger_entry DROP CONSTRAINT credit_ledger_entry_kind_check;
ALTER TABLE credit_ledger_entry ADD CONSTRAINT credit_ledger_entry_kind_check CHECK (kind IN ('spend', 'expire', 'revoke'));
