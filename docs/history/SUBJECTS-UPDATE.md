# Subjects per class + teacher class/subject combos

Run `node scripts/db-push.mjs` in server/ (pushes db/class-subjects.sql), then rebuild the client.

- New table class_subjects (which subjects each class studies). Filled automatically from existing teacher combos and tests.
- Academics > Class subjects (new): every class with its subjects and teachers, red "No teacher" where a subject is not covered. Tap a class to choose its subjects, or copy the list to other classes.
- Adding a teacher (role Staff): "This person teaches" is on by default and needs at least one class + subject. Switch off for office staff / drivers.
- Teacher's Teaching editor: a class only accepts subjects it studies (greyed out otherwise). Saving combos keeps the class subject list in step.
- Tests / exam papers: the subject list follows the chosen class; teachers without "all classes" only get their own class + subject combos. The server enforces the same rule.
- Timetable class view: warns about subjects of the class that have no teacher yet.
