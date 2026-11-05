-- Periods per week for each class + subject (set once by the admin in Timetable > Structure, not per teacher).
alter table class_subjects add column if not exists periods_per_week int check (periods_per_week is null or periods_per_week between 0 and 40);
