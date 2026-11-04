-- 작품 등록 메타데이터(#49): 작품 유형, 공용 장르 목록, 해시태그.
ALTER TABLE work ADD COLUMN creation_type text NOT NULL DEFAULT 'original'
    CHECK (creation_type IN ('original', 'external_derivative'));

INSERT INTO genre (id, code, name) VALUES
    ('genre-01', 'genre-01', '판타지'),
    ('genre-02', 'genre-02', '현대판타지'),
    ('genre-03', 'genre-03', '무협'),
    ('genre-04', 'genre-04', '선협'),
    ('genre-05', 'genre-05', '퓨전'),
    ('genre-06', 'genre-06', '로맨스'),
    ('genre-07', 'genre-07', '로맨스판타지'),
    ('genre-08', 'genre-08', 'BL'),
    ('genre-09', 'genre-09', 'GL'),
    ('genre-10', 'genre-10', '현대'),
    ('genre-11', 'genre-11', '시대물'),
    ('genre-12', 'genre-12', '역사'),
    ('genre-13', 'genre-13', '대체역사'),
    ('genre-14', 'genre-14', 'SF'),
    ('genre-15', 'genre-15', '게임'),
    ('genre-16', 'genre-16', '스포츠'),
    ('genre-17', 'genre-17', '드라마'),
    ('genre-18', 'genre-18', '미스터리'),
    ('genre-19', 'genre-19', '추리'),
    ('genre-20', 'genre-20', '스릴러'),
    ('genre-21', 'genre-21', '공포'),
    ('genre-22', 'genre-22', '오컬트'),
    ('genre-23', 'genre-23', '액션'),
    ('genre-24', 'genre-24', '전쟁·밀리터리'),
    ('genre-25', 'genre-25', '라이트노벨'),
    ('genre-26', 'genre-26', '학원'),
    ('genre-27', 'genre-27', '일상'),
    ('genre-28', 'genre-28', '고전'),
    ('genre-29', 'genre-29', '일반소설'),
    ('genre-30', 'genre-30', '기타');

CREATE TABLE work_hashtag (
    id varchar(36) PRIMARY KEY,
    work_id varchar(36) NOT NULL REFERENCES work(id),
    tag text NOT NULL,
    position int NOT NULL,
    UNIQUE (work_id, position)
);
