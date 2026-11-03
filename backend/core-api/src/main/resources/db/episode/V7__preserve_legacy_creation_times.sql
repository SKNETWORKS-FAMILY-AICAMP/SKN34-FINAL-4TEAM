-- Preserve the original creation order rather than the import execution order.
UPDATE work w SET created_at=legacy.created_at FROM content_work legacy WHERE w.id=legacy.id;
UPDATE world w SET created_at=legacy.created_at FROM content_work legacy WHERE w.id=legacy.id;
