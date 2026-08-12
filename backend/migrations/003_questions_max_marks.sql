ALTER TABLE questions ADD COLUMN IF NOT EXISTS max_marks integer NOT NULL DEFAULT 5;
ALTER TABLE question_grades DROP CONSTRAINT IF EXISTS question_grades_grade_check;
