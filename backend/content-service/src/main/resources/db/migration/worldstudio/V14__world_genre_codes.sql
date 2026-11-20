-- 세계관 장르를 작품 장르(Content genre)와 합친다(DEC-56). 세계관 장르는 이제 Content 장르 코드(genre-NN)이며 있는지·활성인지는 서비스가 genre 표로 확인한다.
-- worldstudio는 별도 Flyway 이력이라 외래키를 두지 않는다. V13은 다른 열린 PR 몫이라 비워 둔다.
ALTER TABLE worldstudio.world DROP CONSTRAINT world_genre_check;
-- 옛 영문 코드 일곱 개를 Content 장르 코드로 바꾼다. 그 밖의 값(NULL 포함)은 건드리지 않는다.
UPDATE worldstudio.world SET genre = CASE genre
    WHEN 'fantasy' THEN 'genre-01'
    WHEN 'wuxia' THEN 'genre-03'
    WHEN 'romance' THEN 'genre-06'
    WHEN 'modern' THEN 'genre-10'
    WHEN 'sf' THEN 'genre-14'
    WHEN 'mystery' THEN 'genre-18'
    WHEN 'classic' THEN 'genre-28'
END
WHERE genre IN ('fantasy', 'wuxia', 'romance', 'modern', 'sf', 'mystery', 'classic');
