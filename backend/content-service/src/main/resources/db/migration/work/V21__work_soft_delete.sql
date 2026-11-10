-- 작품 소프트 삭제(DEC-42, #108). 행은 지우지 않고 삭제 시각만 기록한다.
-- 삭제된 작품은 목록·검색·랭킹·읽기·분기 생성에서 제외하고, 이 작품을 원작으로 둔 Fork는 원작 행을 그대로 참조한 채 "삭제된 원작"으로 표시한다.
ALTER TABLE work ADD COLUMN deleted_at timestamptz;
