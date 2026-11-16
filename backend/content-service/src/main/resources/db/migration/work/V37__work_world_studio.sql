-- 세계관(WorldStudio)과 소설의 1:1 연결(DEC-46). 작품이 연결한 worldstudio.world.id이며 연결이 없으면 NULL이다.
-- UNIQUE라 한 세계관은 한 작품에만 연결된다(NULL은 여러 행에 있을 수 있다). worldstudio는 별도 Flyway 이력이라 FK를 두지 않는다.
ALTER TABLE work ADD COLUMN world_studio_id uuid UNIQUE;
