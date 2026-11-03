
BEGIN;

CREATE TRIGGER evaluation_sessions_guard_workflow
BEFORE UPDATE ON public.evaluation_sessions
FOR EACH ROW
EXECUTE FUNCTION public.guard_evaluation_workflow_write();

CREATE TRIGGER evaluations_guard_workflow
BEFORE INSERT OR UPDATE OR DELETE ON public.evaluations
FOR EACH ROW
EXECUTE FUNCTION public.guard_evaluation_workflow_write();

CREATE TRIGGER ratings_guard_workflow
BEFORE INSERT OR UPDATE OR DELETE ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.guard_evaluation_workflow_write();

CREATE TRIGGER experience_answers_guard_workflow
BEFORE INSERT OR UPDATE OR DELETE ON public.experience_answers
FOR EACH ROW
EXECUTE FUNCTION public.guard_evaluation_workflow_write();

CREATE TRIGGER evaluator_notes_guard_workflow
BEFORE INSERT OR UPDATE OR DELETE ON public.evaluator_notes
FOR EACH ROW
EXECUTE FUNCTION public.guard_evaluation_workflow_write();

COMMIT;
