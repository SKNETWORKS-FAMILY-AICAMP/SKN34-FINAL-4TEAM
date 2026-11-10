-- 운영 댓글 숨김(기능 75). 원문은 지우지 않고 공개 응답에서만 자리표시로 바꾸며, 게시 복구로 되돌릴 수 있다.
ALTER TABLE episode_comment ADD COLUMN hidden boolean NOT NULL DEFAULT false;
