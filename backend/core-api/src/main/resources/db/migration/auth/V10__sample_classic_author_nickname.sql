-- 고전 원작(구운몽·홍길동전)의 소유 샘플 계정(sample/V9)이 운영자처럼 보이지 않도록 표시 닉네임을 바꾼다.
-- Content는 작가명을 소유자의 Core 닉네임으로 보여 준다. 회원이 이미 닉네임을 바꿨다면 덮어쓰지 않고, 다시 실행해도 결과가 같다.
UPDATE auth_member SET nickname = '고전 아카이브'
WHERE id = 'b1b09f26-1c1e-3a11-9bb1-6f0d7927ab44' AND nickname = '운영팀';
