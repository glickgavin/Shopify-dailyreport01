-- Units column for the discount report should count only Magic Portrait line
-- items (the primary product), excluding mugs, downloads, memberships, etc.
-- units keeps the all-items count; units_primary is the filtered count.
alter table daily_discounts add column if not exists units_primary integer not null default 0;
