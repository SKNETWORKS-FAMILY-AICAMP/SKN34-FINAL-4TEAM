-- Last AI review of a world's settings (#555). One row per world; every successful review overwrites it, a failed review leaves it alone.
-- result is the review answer without its time (draftRevision, reviewedCards, totalCards, findings, model) plus basis, the text of each card a fix points at.
CREATE TABLE worldstudio.world_review_result (
    world_id uuid PRIMARY KEY REFERENCES worldstudio.world(id),
    result jsonb NOT NULL,
    reviewed_at timestamptz NOT NULL
);
