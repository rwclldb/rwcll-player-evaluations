-- Historical coach evaluations: schema and controlled matching staging.
-- Apply to LOCAL Supabase first. Do not apply to hosted Supabase without explicit approval.
-- Unresolved imports remain in staging and never create or merge player records automatically.

BEGIN;

ALTER TABLE public.historical_evaluations
  ADD COLUMN source_season_id bigint,
  ADD COLUMN source_coach_user_id uuid,
  ADD COLUMN source_coach_name text,
  ADD COLUMN source_player_id text,
  ADD COLUMN player_match_method text,
  ADD COLUMN source_import_batch_id bigint,
  ADD COLUMN source_import_row_number integer,
  ADD COLUMN imported_by uuid,
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_reason text;

ALTER TABLE public.historical_evaluations
  ADD CONSTRAINT historical_evaluations_source_season_id_fkey
    FOREIGN KEY (source_season_id) REFERENCES public.seasons(id) ON DELETE RESTRICT,
  ADD CONSTRAINT historical_evaluations_source_coach_user_id_fkey
    FOREIGN KEY (source_coach_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT historical_evaluations_source_import_batch_id_fkey
    FOREIGN KEY (source_import_batch_id) REFERENCES public.import_batches(id) ON DELETE RESTRICT,
  ADD CONSTRAINT historical_evaluations_imported_by_fkey
    FOREIGN KEY (imported_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT historical_evaluations_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT historical_evaluations_source_import_row_number_check
    CHECK (source_import_row_number IS NULL OR source_import_row_number > 0),
  ADD CONSTRAINT historical_evaluations_player_match_method_check
    CHECK (player_match_method IS NULL OR player_match_method IN
      ('player_id', 'name_and_details', 'manual_review', 'legacy_unmatched'));

ALTER TABLE public.historical_ratings
  ADD COLUMN rating_category_id bigint,
  ADD COLUMN source_category_code text;

ALTER TABLE public.historical_ratings
  ADD CONSTRAINT historical_ratings_rating_category_id_fkey
    FOREIGN KEY (rating_category_id) REFERENCES public.rating_categories(id) ON DELETE RESTRICT;

CREATE TABLE public.historical_evaluation_import_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch_id bigint NOT NULL REFERENCES public.import_batches(id) ON DELETE RESTRICT,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  source_data jsonb NOT NULL,
  source_player_id text,
  first_name text,
  last_name text,
  birth_date date,
  source_season_label text,
  source_division_name text,
  source_team_label text,
  source_coach_name text,
  candidate_player_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[],
  resolved_player_id bigint REFERENCES public.players(id) ON DELETE RESTRICT,
  match_method text CHECK (match_method IS NULL OR match_method IN
    ('player_id', 'name_and_details', 'manual_review')),
  review_state text NOT NULL DEFAULT 'pending_review'
    CHECK (review_state IN ('pending_review', 'approved_match', 'rejected', 'imported')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_reason text,
  imported_historical_evaluation_id bigint
    REFERENCES public.historical_evaluations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT historical_evaluation_import_rows_batch_row_key
    UNIQUE (import_batch_id, source_row_number),
  CONSTRAINT historical_evaluation_import_rows_approval_check
    CHECK (
      (review_state NOT IN ('approved_match', 'imported'))
      OR resolved_player_id IS NOT NULL
    ),
  CONSTRAINT historical_evaluation_import_rows_imported_link_check
    CHECK (
      (review_state <> 'imported')
      OR imported_historical_evaluation_id IS NOT NULL
    )
);

CREATE INDEX historical_evaluations_player_season_idx
  ON public.historical_evaluations (player_id, source_season_id);
CREATE INDEX historical_evaluations_source_import_batch_idx
  ON public.historical_evaluations (source_import_batch_id);
CREATE INDEX historical_evaluation_import_rows_state_idx
  ON public.historical_evaluation_import_rows (import_batch_id, review_state);
CREATE INDEX historical_evaluation_import_rows_resolved_player_idx
  ON public.historical_evaluation_import_rows (resolved_player_id)
  WHERE resolved_player_id IS NOT NULL;

ALTER TABLE public.historical_evaluation_import_rows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.historical_evaluation_import_rows FROM anon;
REVOKE ALL ON TABLE public.historical_evaluation_import_rows FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.historical_evaluation_import_rows TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.historical_evaluation_import_rows_id_seq TO authenticated;

-- Historical data and staging are admin-only until secure report RPCs explicitly
-- authorize limited coach access. Frontend filtering is not an access-control boundary.
CREATE POLICY historical_evaluation_import_rows_admin_all
  ON public.historical_evaluation_import_rows
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY historical_evaluations_admin_select
  ON public.historical_evaluations
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY historical_evaluations_admin_insert
  ON public.historical_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY historical_evaluations_admin_update
  ON public.historical_evaluations
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY historical_ratings_admin_select
  ON public.historical_ratings
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY historical_ratings_admin_insert
  ON public.historical_ratings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY historical_ratings_admin_update
  ON public.historical_ratings
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE public.historical_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.historical_ratings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.historical_evaluation_import_rows_id_seq TO authenticated;

COMMIT;
