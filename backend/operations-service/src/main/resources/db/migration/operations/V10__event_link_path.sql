-- DEC-57: an event can point to a feature inside the site. Optional; the service accepts only an in-site path (starts with "/", at most 200 characters).
ALTER TABLE operations.event ADD COLUMN link_path VARCHAR(200);
