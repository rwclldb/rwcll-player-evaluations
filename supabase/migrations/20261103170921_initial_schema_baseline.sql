SET local check_function_bodies = off;

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";

CREATE TABLE "public"."audit_log" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "actor_user_id" uuid,
  "action"        text                     NOT NULL,
  "target_table"  text                     NOT NULL,
  "target_id"     text,
  "reason"        text,
  "before_data"   jsonb,
  "after_data"    jsonb,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audit_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_log"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."audit_log" FROM "anon";

CREATE TABLE "public"."division_rating_categories" (
  "id"                 bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "division_id"        bigint                   NOT NULL,
  "rating_category_id" bigint                   NOT NULL,
  "is_required"        boolean                  NOT NULL DEFAULT false,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "division_rating_categories_division_id_rating_category_id_key" UNIQUE (division_id, rating_category_id),
  CONSTRAINT "division_rating_categories_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."division_rating_categories"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."division_rating_categories" FROM "anon";

CREATE TABLE "public"."divisions" (
  "id"                  bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name"                text                     NOT NULL,
  "sort_order"          integer                  NOT NULL DEFAULT 0,
  "evaluations_enabled" boolean                  NOT NULL DEFAULT true,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "divisions_name_key" UNIQUE (name),
  CONSTRAINT "divisions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."divisions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."divisions" FROM "anon";

CREATE TABLE "public"."evaluation_sessions" (
  "id"                 bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "season_division_id" bigint                   NOT NULL,
  "status"             text                     NOT NULL DEFAULT 'setup'::text,
  "created_by"         uuid,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "published_at"       timestamp with time zone,
  "published_by"       uuid,
  CONSTRAINT "evaluation_sessions_id_season_division_id_key" UNIQUE (id, season_division_id),
  CONSTRAINT "evaluation_sessions_must_be_locked_to_publish" CHECK (((published_at IS NULL) OR (status = 'locked'::text))),
  CONSTRAINT "evaluation_sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "evaluation_sessions_publication_metadata_check" CHECK (((published_at IS NULL) = (published_by IS NULL))),
  CONSTRAINT "evaluation_sessions_season_division_id_key" UNIQUE (season_division_id),
  CONSTRAINT "evaluation_sessions_status_check" CHECK ((status = ANY (ARRAY['setup'::text, 'open'::text, 'locked'::text])))
);

ALTER TABLE "public"."evaluation_sessions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."evaluation_sessions" FROM "anon";

CREATE TABLE "public"."evaluations" (
  "id"                    bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "evaluation_session_id" bigint                   NOT NULL,
  "season_division_id"    bigint                   NOT NULL,
  "player_season_id"      bigint                   NOT NULL,
  "evaluator_user_id"     uuid                     NOT NULL,
  "evaluator_type"        text                     NOT NULL,
  "status"                text                     NOT NULL DEFAULT 'draft'::text,
  "submitted_at"          timestamp with time zone,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "evaluations_check" CHECK ((((status = 'submitted'::text) AND (submitted_at IS NOT NULL)) OR ((status <> 'submitted'::text) AND (submitted_at IS NULL)))),
  CONSTRAINT "evaluations_evaluation_session_id_player_season_id_evaluato_key" UNIQUE (evaluation_session_id, player_season_id, evaluator_user_id),
  CONSTRAINT "evaluations_evaluator_type_check" CHECK ((evaluator_type = ANY (ARRAY['coach'::text, 'independent_evaluator'::text]))),
  CONSTRAINT "evaluations_id_evaluator_type_key" UNIQUE (id, evaluator_type),
  CONSTRAINT "evaluations_pkey" PRIMARY KEY (id),
  CONSTRAINT "evaluations_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'not_evaluated'::text])))
);

ALTER TABLE "public"."evaluations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."evaluations" FROM "anon";

CREATE TABLE "public"."evaluator_assignments" (
  "id"                    bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "evaluation_session_id" bigint                   NOT NULL,
  "evaluator_user_id"     uuid                     NOT NULL,
  "evaluator_type"        text                     NOT NULL,
  "assigned_by"           uuid,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "evaluator_assignments_evaluation_session_id_evaluator_user__key" UNIQUE (evaluation_session_id, evaluator_user_id),
  CONSTRAINT "evaluator_assignments_evaluator_type_check" CHECK ((evaluator_type = ANY (ARRAY['coach'::text, 'independent_evaluator'::text]))),
  CONSTRAINT "evaluator_assignments_pkey" PRIMARY KEY (id),
  CONSTRAINT "evaluator_assignments_session_user_type_unique" UNIQUE (evaluation_session_id, evaluator_user_id, evaluator_type)
);

ALTER TABLE "public"."evaluator_assignments"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."evaluator_assignments" FROM "anon";

CREATE TABLE "public"."evaluator_notes" (
  "id"             bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "evaluation_id"  bigint                   NOT NULL,
  "author_user_id" uuid                     NOT NULL,
  "note_text"      text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "evaluator_notes_evaluation_id_key" UNIQUE (evaluation_id),
  CONSTRAINT "evaluator_notes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."evaluator_notes"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."evaluator_notes" FROM "anon";

CREATE TABLE "public"."experience_answers" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "evaluation_id" bigint                   NOT NULL,
  "question_code" text                     NOT NULL,
  "answer"        text                     NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "experience_answers_answer_check" CHECK ((answer = ANY (ARRAY['yes'::text, 'no'::text, 'unknown'::text]))),
  CONSTRAINT "experience_answers_evaluation_id_question_code_key" UNIQUE (evaluation_id, question_code),
  CONSTRAINT "experience_answers_pkey" PRIMARY KEY (id),
  CONSTRAINT "experience_answers_question_code_check"
    CHECK ((question_code = ANY (ARRAY['pitched_before'::text, 'caught_before'::text, 'interested_in_pitching'::text, 'interested_in_catching'::text])))
);

ALTER TABLE "public"."experience_answers"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."experience_answers" FROM "anon";

CREATE TABLE "public"."historical_evaluations" (
  "id"                   bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "player_id"            bigint                   NOT NULL,
  "source_season_label"  text                     NOT NULL,
  "source_division_name" text                     NOT NULL,
  "source_team_label"    text,
  "coverage_note"        text,
  "created_by"           uuid,
  "imported_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "historical_evaluations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."historical_evaluations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."historical_evaluations" FROM "anon";

CREATE TABLE "public"."historical_ratings" (
  "id"                       bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "historical_evaluation_id" bigint                   NOT NULL,
  "category_name"            text                     NOT NULL,
  "score"                    integer                  NOT NULL,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "historical_ratings_historical_evaluation_id_category_name_key" UNIQUE (historical_evaluation_id, category_name),
  CONSTRAINT "historical_ratings_pkey" PRIMARY KEY (id),
  CONSTRAINT "historical_ratings_score_check" CHECK (((score >= 1) AND (score <= 5)))
);

ALTER TABLE "public"."historical_ratings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."historical_ratings" FROM "anon";

CREATE TABLE "public"."import_batches" (
  "id"               bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "import_type"      text                     NOT NULL,
  "source_file_name" text,
  "status"           text                     NOT NULL DEFAULT 'pending'::text,
  "rows_received"    integer                  NOT NULL DEFAULT 0,
  "rows_processed"   integer                  NOT NULL DEFAULT 0,
  "rows_with_errors" integer                  NOT NULL DEFAULT 0,
  "created_by"       uuid,
  "started_at"       timestamp with time zone,
  "completed_at"     timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "import_batches_check1" CHECK ((rows_with_errors <= rows_received)),
  CONSTRAINT "import_batches_check" CHECK ((rows_processed <= rows_received)),
  CONSTRAINT "import_batches_import_type_check" CHECK ((import_type = ANY (ARRAY['players'::text, 'historical_evaluations'::text, 'historical_ratings'::text]))),
  CONSTRAINT "import_batches_pkey" PRIMARY KEY (id),
  CONSTRAINT "import_batches_rows_processed_check" CHECK ((rows_processed >= 0)),
  CONSTRAINT "import_batches_rows_received_check" CHECK ((rows_received >= 0)),
  CONSTRAINT "import_batches_rows_with_errors_check" CHECK ((rows_with_errors >= 0)),
  CONSTRAINT "import_batches_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'completed_with_errors'::text, 'failed'::text])))
);

ALTER TABLE "public"."import_batches"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."import_batches" FROM "anon";

CREATE TABLE "public"."player_seasons" (
  "id"                       bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "player_id"                bigint                   NOT NULL,
  "season_id"                bigint                   NOT NULL,
  "season_division_id"       bigint                   NOT NULL,
  "external_registration_id" text,
  "league_age"               integer,
  "evaluation_number"        integer,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "team_id"                  bigint,
  CONSTRAINT "player_seasons_evaluation_number_check" CHECK (((evaluation_number IS NULL) OR (evaluation_number > 0))),
  CONSTRAINT "player_seasons_id_division_unique" UNIQUE (id, season_division_id),
  CONSTRAINT "player_seasons_pkey" PRIMARY KEY (id),
  CONSTRAINT "player_seasons_player_id_season_id_key" UNIQUE (player_id, season_id)
);

ALTER TABLE "public"."player_seasons"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."player_seasons" FROM "anon";

CREATE TABLE "public"."players" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "first_name"    text                     NOT NULL,
  "last_name"     text                     NOT NULL,
  "date_of_birth" date,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "players_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."players"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."players" FROM "anon";

CREATE TABLE "public"."private_notes" (
  "id"               bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "player_season_id" bigint                   NOT NULL,
  "author_user_id"   uuid                     NOT NULL,
  "note_text"        text                     NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "private_notes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."private_notes"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."private_notes" FROM "anon";

CREATE TABLE "public"."rating_categories" (
  "id"             bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "code"           text                     NOT NULL,
  "name"           text                     NOT NULL,
  "category_group" text                     NOT NULL,
  "sort_order"     integer                  NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rating_categories_category_group_check" CHECK ((category_group = ANY (ARRAY['core'::text, 'pitching'::text, 'catching'::text]))),
  CONSTRAINT "rating_categories_code_key" UNIQUE (code),
  CONSTRAINT "rating_categories_name_key" UNIQUE (name),
  CONSTRAINT "rating_categories_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."rating_categories"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."rating_categories" FROM "anon";

CREATE TABLE "public"."ratings" (
  "id"                 bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "evaluation_id"      bigint                   NOT NULL,
  "rating_category_id" bigint                   NOT NULL,
  "score"              integer                  NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ratings_evaluation_id_rating_category_id_key" UNIQUE (evaluation_id, rating_category_id),
  CONSTRAINT "ratings_pkey" PRIMARY KEY (id),
  CONSTRAINT "ratings_score_check" CHECK (((score >= 1) AND (score <= 5)))
);

ALTER TABLE "public"."ratings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."ratings" FROM "anon";

CREATE TABLE "public"."season_divisions" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "season_id"   bigint                   NOT NULL,
  "division_id" bigint                   NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "season_divisions_id_season_id_key" UNIQUE (id, season_id),
  CONSTRAINT "season_divisions_pkey" PRIMARY KEY (id),
  CONSTRAINT "season_divisions_season_id_division_id_key" UNIQUE (season_id, division_id)
);

ALTER TABLE "public"."season_divisions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."season_divisions" FROM "anon";

CREATE TABLE "public"."seasons" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name"       text                     NOT NULL,
  "start_date" date,
  "end_date"   date,
  "is_closed"  boolean                  NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "seasons_check" CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (start_date <= end_date))),
  CONSTRAINT "seasons_name_key" UNIQUE (name),
  CONSTRAINT "seasons_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."seasons"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."seasons" FROM "anon";

CREATE TABLE "public"."team_coach_assignments" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "team_id"         bigint                   NOT NULL,
  "season_id"       bigint                   NOT NULL,
  "coach_user_id"   uuid                     NOT NULL,
  "assignment_role" text                     NOT NULL DEFAULT 'coach'::text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "team_coach_assignments_assignment_role_check" CHECK ((assignment_role = ANY (ARRAY['head_coach'::text, 'assistant_coach'::text]))),
  CONSTRAINT "team_coach_assignments_pkey" PRIMARY KEY (id),
  CONSTRAINT "team_coach_assignments_team_id_coach_user_id_key" UNIQUE (team_id, coach_user_id)
);

ALTER TABLE "public"."team_coach_assignments"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."team_coach_assignments" FROM "anon";

CREATE TABLE "public"."teams" (
  "id"                 bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "season_id"          bigint                   NOT NULL,
  "season_division_id" bigint                   NOT NULL,
  "name"               text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "teams_id_season_division_id_season_id_key" UNIQUE (id, season_division_id, season_id),
  CONSTRAINT "teams_id_season_id_key" UNIQUE (id, season_id),
  CONSTRAINT "teams_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."teams"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."teams" FROM "anon";

CREATE TABLE "public"."user_profiles" (
  "user_id"      uuid                     NOT NULL,
  "display_name" text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."user_profiles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_profiles" FROM "anon";

CREATE TABLE "public"."user_roles" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "role_name"  text                     NOT NULL,
  "season_id"  bigint,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_roles_check" CHECK ((((role_name = 'administrator'::text) AND (season_id IS NULL)) OR ((role_name <> 'administrator'::text) AND (season_id IS NOT NULL)))),
  CONSTRAINT "user_roles_pkey" PRIMARY KEY (id),
  CONSTRAINT "user_roles_role_name_check" CHECK ((role_name = ANY (ARRAY['administrator'::text, 'coach'::text, 'independent_evaluator'::text])))
);

ALTER TABLE "public"."user_roles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_roles" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."audit_log_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."division_rating_categories_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."divisions_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."evaluation_sessions_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."evaluations_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."evaluator_assignments_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."evaluator_notes_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."experience_answers_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."historical_evaluations_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."historical_ratings_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."import_batches_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."player_seasons_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."players_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."private_notes_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."rating_categories_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."ratings_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."season_divisions_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."seasons_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."team_coach_assignments_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."teams_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."user_roles_id_seq" FROM "anon";

CREATE OR REPLACE FUNCTION public.can_access_season_division (
  p_season_division_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.season_divisions AS sd
    WHERE sd.id = p_season_division_id
      AND (
        -- Coaches can access divisions in their assigned season.
        EXISTS (
          SELECT 1
          FROM public.user_roles AS ur
          WHERE ur.user_id = (SELECT auth.uid())
            AND ur.role_name = 'coach'
            AND ur.season_id = sd.season_id
        )

        OR

        -- Independent evaluators must have both a season role
        -- and an assignment to this division's evaluation session.
        EXISTS (
          SELECT 1
          FROM public.evaluation_sessions AS es
          JOIN public.evaluator_assignments AS ea
            ON ea.evaluation_session_id = es.id
          JOIN public.user_roles AS ur
            ON ur.user_id = ea.evaluator_user_id
           AND ur.role_name = 'independent_evaluator'
           AND ur.season_id = sd.season_id
          WHERE es.season_division_id = sd.id
            AND ea.evaluator_user_id = (SELECT auth.uid())
            AND ea.evaluator_type = 'independent_evaluator'
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION "public"."can_access_season_division"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.has_season_role (
  p_role      text,
  p_season_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
  SELECT
    p_role IN ('coach', 'independent_evaluator')
    AND p_season_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role_name = p_role
        AND ur.season_id = p_season_id
    );
$function$;

REVOKE ALL ON FUNCTION "public"."has_season_role"(text, bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role_name = 'administrator'
      AND ur.season_id IS NULL
  );
$function$;

REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_assigned_evaluator (
  p_session_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.evaluator_assignments AS ea
    WHERE ea.evaluation_session_id = p_session_id
      AND ea.evaluator_user_id = (SELECT auth.uid())
      AND ea.evaluator_type = 'independent_evaluator'
  );
$function$;

REVOKE ALL ON FUNCTION "public"."is_assigned_evaluator"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.prevent_audit_log_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  RAISE EXCEPTION
    'Audit log entries cannot be updated or deleted.';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."prevent_audit_log_changes"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.protect_publication_metadata()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
BEGIN
  IF current_user <> 'postgres' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.published_at IS NOT NULL
         OR NEW.published_by IS NOT NULL THEN
        RAISE EXCEPTION
          'Publication metadata must be changed through an authorized database function';
      END IF;
    ELSIF NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
      RAISE EXCEPTION
        'Publication metadata must be changed through an authorized database function';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."protect_publication_metadata"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.publish_evaluation_session (
  p_session_id bigint,
  p_reason     text   DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
DECLARE
  v_status text;
  v_published_at timestamptz;
BEGIN
  -- Only administrators may publish results.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator permission required';
  END IF;

  -- Lock the session row to prevent simultaneous publication.
  SELECT es.status, es.published_at
  INTO v_status, v_published_at
  FROM public.evaluation_sessions AS es
  WHERE es.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session not found';
  END IF;

  IF v_status <> 'locked' THEN
    RAISE EXCEPTION 'Session must be locked before publication';
  END IF;

  IF v_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Session has already been published';
  END IF;

  UPDATE public.evaluation_sessions
  SET published_at = pg_catalog.now(),
      published_by = (SELECT auth.uid())
  WHERE id = p_session_id;

  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    reason,
    before_data,
    after_data
  )
  VALUES (
    (SELECT auth.uid()),
    'publish_evaluation_session',
    'evaluation_sessions',
    p_session_id,
    NULLIF(pg_catalog.btrim(p_reason), ''),
    pg_catalog.jsonb_build_object(
      'status', v_status,
      'published_at', v_published_at
    ),
    pg_catalog.jsonb_build_object(
      'status', v_status,
      'published_at', pg_catalog.now(),
      'published_by', (SELECT auth.uid())
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION "public"."publish_evaluation_session"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_evaluation_status()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
DECLARE
  v_core_category_count integer;
  v_rated_core_count integer;
  v_rating_count integer;
BEGIN
  IF NEW.status = 'submitted' THEN
    NEW.submitted_at := COALESCE(NEW.submitted_at, now());

    SELECT count(*)
      INTO v_core_category_count
    FROM public.rating_categories
    WHERE category_group = 'core';

    SELECT count(DISTINCT r.rating_category_id)
      INTO v_rated_core_count
    FROM public.ratings AS r
    JOIN public.rating_categories AS c
      ON c.id = r.rating_category_id
    WHERE r.evaluation_id = NEW.id
      AND c.category_group = 'core';

    IF v_core_category_count <> 5
       OR v_rated_core_count <> 5 THEN
      RAISE EXCEPTION
        'Cannot submit: all five core skill ratings are required.';
    END IF;

  ELSIF NEW.status = 'not_evaluated' THEN
    SELECT count(*)
      INTO v_rating_count
    FROM public.ratings
    WHERE evaluation_id = NEW.id;

    IF v_rating_count > 0 THEN
      RAISE EXCEPTION
        'A not-evaluated record cannot contain skill ratings.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_evaluation_status"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.validate_rating_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
DECLARE
  v_eval_ids bigint[];
  v_eval_id bigint;
  v_status text;
  v_core_category_count integer;
  v_rated_core_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_eval_ids := ARRAY[NEW.evaluation_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_eval_ids := ARRAY[OLD.evaluation_id];
  ELSE
    v_eval_ids := ARRAY[OLD.evaluation_id, NEW.evaluation_id];
  END IF;

  FOREACH v_eval_id IN ARRAY v_eval_ids LOOP
    IF v_eval_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT e.status
      INTO v_status
    FROM public.evaluations AS e
    WHERE e.id = v_eval_id;

    IF v_status = 'not_evaluated' THEN
      RAISE EXCEPTION
        'Ratings cannot be added to a not-evaluated record.';
    END IF;

    IF v_status = 'submitted' THEN
      SELECT count(*)
        INTO v_core_category_count
      FROM public.rating_categories
      WHERE category_group = 'core';

      SELECT count(DISTINCT r.rating_category_id)
        INTO v_rated_core_count
      FROM public.ratings AS r
      JOIN public.rating_categories AS c
        ON c.id = r.rating_category_id
      WHERE r.evaluation_id = v_eval_id
        AND c.category_group = 'core';

      IF v_core_category_count <> 5
         OR v_rated_core_count <> 5 THEN
        RAISE EXCEPTION
          'A submitted evaluation must retain all five core ratings.';
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."validate_rating_change"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."audit_log"
  ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."division_rating_categories"
  ADD CONSTRAINT "division_rating_categories_division_id_fkey" FOREIGN KEY (division_id) REFERENCES public.divisions(id) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluation_sessions"
  ADD CONSTRAINT "evaluation_sessions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."evaluation_sessions"
  ADD CONSTRAINT "evaluation_sessions_published_by_fkey" FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluations"
  ADD CONSTRAINT "evaluations_evaluation_session_id_season_division_id_fkey" FOREIGN KEY (evaluation_session_id, season_division_id)
    REFERENCES public.evaluation_sessions(id, season_division_id) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluator_assignments"
  ADD CONSTRAINT "evaluator_assignments_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."evaluator_assignments"
  ADD CONSTRAINT "evaluator_assignments_evaluation_session_id_fkey" FOREIGN KEY (evaluation_session_id) REFERENCES public.evaluation_sessions(id) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluator_assignments"
  ADD CONSTRAINT "evaluator_assignments_evaluator_user_id_fkey" FOREIGN KEY (evaluator_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluations"
  ADD CONSTRAINT "evaluations_evaluation_session_id_evaluator_user_id_evalua_fkey" FOREIGN KEY (evaluation_session_id, evaluator_user_id, evaluator_type)
    REFERENCES public.evaluator_assignments(evaluation_session_id, evaluator_user_id, evaluator_type) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluator_notes"
  ADD CONSTRAINT "evaluator_notes_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluator_notes"
  ADD CONSTRAINT "evaluator_notes_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE RESTRICT;

ALTER TABLE "public"."experience_answers"
  ADD CONSTRAINT "experience_answers_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE RESTRICT;

ALTER TABLE "public"."historical_evaluations"
  ADD CONSTRAINT "historical_evaluations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."historical_ratings"
  ADD CONSTRAINT "historical_ratings_historical_evaluation_id_fkey" FOREIGN KEY (historical_evaluation_id) REFERENCES public.historical_evaluations(id) ON DELETE RESTRICT;

ALTER TABLE "public"."import_batches"
  ADD CONSTRAINT "import_batches_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."evaluations"
  ADD CONSTRAINT "evaluations_player_season_id_season_division_id_fkey" FOREIGN KEY (player_season_id, season_division_id) REFERENCES public.player_seasons(id, season_division_id)
    ON DELETE RESTRICT;

ALTER TABLE "public"."historical_evaluations"
  ADD CONSTRAINT "historical_evaluations_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE RESTRICT;

ALTER TABLE "public"."player_seasons"
  ADD CONSTRAINT "player_seasons_player_id_fkey" FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE RESTRICT;

ALTER TABLE "public"."private_notes"
  ADD CONSTRAINT "private_notes_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."private_notes"
  ADD CONSTRAINT "private_notes_player_season_id_fkey" FOREIGN KEY (player_season_id) REFERENCES public.player_seasons(id) ON DELETE RESTRICT;

ALTER TABLE "public"."division_rating_categories"
  ADD CONSTRAINT "division_rating_categories_rating_category_id_fkey" FOREIGN KEY (rating_category_id) REFERENCES public.rating_categories(id) ON DELETE RESTRICT;

ALTER TABLE "public"."ratings"
  ADD CONSTRAINT "ratings_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE RESTRICT;

ALTER TABLE "public"."ratings"
  ADD CONSTRAINT "ratings_rating_category_id_fkey" FOREIGN KEY (rating_category_id) REFERENCES public.rating_categories(id) ON DELETE RESTRICT;

ALTER TABLE "public"."season_divisions"
  ADD CONSTRAINT "season_divisions_division_id_fkey" FOREIGN KEY (division_id) REFERENCES public.divisions(id);

ALTER TABLE "public"."player_seasons"
  ADD CONSTRAINT "player_seasons_season_division_id_season_id_fkey" FOREIGN KEY (season_division_id, season_id) REFERENCES public.season_divisions(id, season_id) ON DELETE RESTRICT;

ALTER TABLE "public"."evaluation_sessions"
  ADD CONSTRAINT "evaluation_sessions_season_division_id_fkey" FOREIGN KEY (season_division_id) REFERENCES public.season_divisions(id) ON DELETE RESTRICT;

ALTER TABLE "public"."player_seasons"
  ADD CONSTRAINT "player_seasons_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE RESTRICT;

ALTER TABLE "public"."season_divisions"
  ADD CONSTRAINT "season_divisions_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id);

ALTER TABLE "public"."team_coach_assignments"
  ADD CONSTRAINT "team_coach_assignments_coach_user_id_fkey" FOREIGN KEY (coach_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."player_seasons"
  ADD CONSTRAINT "player_seasons_team_matches_registration" FOREIGN KEY (team_id, season_division_id, season_id) REFERENCES public.teams(id, season_division_id, season_id)
    ON DELETE RESTRICT;

ALTER TABLE "public"."team_coach_assignments"
  ADD CONSTRAINT "team_coach_assignments_team_id_season_id_fkey" FOREIGN KEY (team_id, season_id) REFERENCES public.teams(id, season_id) ON DELETE RESTRICT;

ALTER TABLE "public"."teams"
  ADD CONSTRAINT "teams_season_division_id_season_id_fkey" FOREIGN KEY (season_division_id, season_id) REFERENCES public.season_divisions(id, season_id) ON DELETE RESTRICT;

ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_season_id_fkey" FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE RESTRICT;

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor_user_id, created_at);

CREATE INDEX audit_log_target_idx ON public.audit_log USING btree (target_table, target_id, created_at);

CREATE UNIQUE INDEX player_seasons_unique_evaluation_number ON public.player_seasons USING btree (season_division_id, evaluation_number)
  WHERE (evaluation_number IS NOT NULL);

CREATE UNIQUE INDEX player_seasons_unique_external_registration ON public.player_seasons USING btree (season_id, external_registration_id)
  WHERE (external_registration_id IS NOT NULL);

CREATE UNIQUE INDEX teams_unique_named_team_per_division ON public.teams USING btree (season_division_id, name)
  WHERE (name IS NOT NULL);

CREATE UNIQUE INDEX user_roles_one_administrator_role ON public.user_roles USING btree (user_id)
  WHERE (role_name = 'administrator'::text);

CREATE UNIQUE INDEX user_roles_one_season_role ON public.user_roles USING btree (user_id, role_name, season_id)
  WHERE (season_id IS NOT NULL);

CREATE TRIGGER audit_log_immutable
  BEFORE DELETE OR UPDATE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_changes();

CREATE TRIGGER protect_evaluation_session_publication
  BEFORE INSERT OR UPDATE OF published_at, published_by ON public.evaluation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_publication_metadata();

CREATE TRIGGER evaluations_validate_status
  BEFORE INSERT OR UPDATE OF status, submitted_at ON public.evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_evaluation_status();

CREATE TRIGGER ratings_validate_changes
  AFTER INSERT OR DELETE OR UPDATE ON public.ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_rating_change();

CREATE POLICY "admins_manage_all" ON "public"."audit_log"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."division_rating_categories"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "division_rating_categories_read_assigned_season" ON "public"."division_rating_categories"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.season_divisions sd
  WHERE ((sd.division_id = division_rating_categories.division_id) AND public.can_access_season_division(sd.id)))));

CREATE POLICY "admins_manage_all" ON "public"."divisions"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "divisions_read_assigned_season" ON "public"."divisions"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.season_divisions sd
  WHERE ((sd.division_id = divisions.id) AND public.can_access_season_division(sd.id)))));

CREATE POLICY "admins_manage_all" ON "public"."evaluation_sessions"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "evaluation_sessions_read_assigned_season" ON "public"."evaluation_sessions"
  FOR SELECT
  TO "authenticated"
  USING (public.can_access_season_division(season_division_id));

CREATE POLICY "admins_manage_all" ON "public"."evaluations"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "evaluations_read_own" ON "public"."evaluations"
  FOR SELECT
  TO "authenticated"
  USING ((evaluator_user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "admins_manage_all" ON "public"."evaluator_assignments"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "evaluator_assignments_read_own" ON "public"."evaluator_assignments"
  FOR SELECT
  TO "authenticated"
  USING ((evaluator_user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "admins_manage_all" ON "public"."evaluator_notes"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."experience_answers"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "experience_answers_read_own" ON "public"."experience_answers"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.evaluations e
  WHERE ((e.id = experience_answers.evaluation_id) AND (e.evaluator_user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "admins_manage_all" ON "public"."historical_evaluations"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."historical_ratings"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."import_batches"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."player_seasons"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "player_seasons_read_authorized_division" ON "public"."player_seasons"
  FOR SELECT
  TO "authenticated"
  USING (public.can_access_season_division(season_division_id));

CREATE POLICY "admins_manage_all" ON "public"."players"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "players_read_authorized_registration" ON "public"."players"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.player_seasons ps
  WHERE ((ps.player_id = players.id) AND public.can_access_season_division(ps.season_division_id)))));

CREATE POLICY "admins_manage_all" ON "public"."private_notes"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."rating_categories"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "rating_categories_read_assigned_season" ON "public"."rating_categories"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM (public.division_rating_categories drc
     JOIN public.season_divisions sd ON ((sd.division_id = drc.division_id)))
  WHERE ((drc.rating_category_id = rating_categories.id) AND public.can_access_season_division(sd.id)))));

CREATE POLICY "admins_manage_all" ON "public"."ratings"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."season_divisions"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "season_divisions_read_assigned_season" ON "public"."season_divisions"
  FOR SELECT
  TO "authenticated"
  USING (public.can_access_season_division(id));

CREATE POLICY "admins_manage_all" ON "public"."seasons"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "seasons_read_assigned_season" ON "public"."seasons"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.season_divisions sd
  WHERE ((sd.season_id = seasons.id) AND public.can_access_season_division(sd.id)))));

CREATE POLICY "admins_manage_all" ON "public"."team_coach_assignments"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."teams"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."user_profiles"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admins_manage_all" ON "public"."user_roles"
  FOR ALL
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT EXECUTE ON FUNCTION "public"."can_access_season_division"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."can_access_season_division"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_access_season_division"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_access_season_division"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."has_season_role"(text, bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."has_season_role"(text, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_season_role"(text, bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_season_role"(text, bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_admin"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_assigned_evaluator"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_assigned_evaluator"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_assigned_evaluator"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_assigned_evaluator"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."prevent_audit_log_changes"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prevent_audit_log_changes"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prevent_audit_log_changes"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."protect_publication_metadata"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_publication_metadata"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_publication_metadata"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."publish_evaluation_session"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."publish_evaluation_session"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."publish_evaluation_session"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."publish_evaluation_session"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_evaluation_status"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_evaluation_status"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_evaluation_status"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_rating_change"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_rating_change"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_rating_change"() TO "service_role";

REVOKE ALL ON SEQUENCE "public"."audit_log_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."audit_log_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."audit_log_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."audit_log_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."division_rating_categories_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."division_rating_categories_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."division_rating_categories_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."division_rating_categories_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."division_rating_categories_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."division_rating_categories_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."divisions_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."divisions_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."divisions_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."divisions_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."divisions_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."divisions_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."evaluation_sessions_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."evaluation_sessions_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."evaluation_sessions_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluation_sessions_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."evaluation_sessions_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluation_sessions_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."evaluations_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."evaluations_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."evaluations_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluations_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."evaluations_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluations_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."evaluator_assignments_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."evaluator_assignments_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."evaluator_assignments_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluator_assignments_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."evaluator_assignments_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluator_assignments_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."evaluator_notes_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."evaluator_notes_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."evaluator_notes_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluator_notes_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."evaluator_notes_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."evaluator_notes_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."experience_answers_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."experience_answers_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."experience_answers_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."experience_answers_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."experience_answers_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."experience_answers_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."historical_evaluations_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."historical_evaluations_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."historical_evaluations_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."historical_evaluations_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."historical_evaluations_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."historical_evaluations_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."historical_ratings_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."historical_ratings_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."historical_ratings_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."historical_ratings_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."historical_ratings_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."historical_ratings_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."import_batches_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."import_batches_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."import_batches_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."import_batches_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."import_batches_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."import_batches_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."player_seasons_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."player_seasons_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."player_seasons_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."player_seasons_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."player_seasons_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."player_seasons_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."players_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."players_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."players_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."players_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."players_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."players_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."private_notes_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."private_notes_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."private_notes_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."private_notes_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."private_notes_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."private_notes_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."rating_categories_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."rating_categories_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."rating_categories_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."rating_categories_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."rating_categories_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."rating_categories_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."ratings_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."ratings_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."ratings_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ratings_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."ratings_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ratings_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."season_divisions_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."season_divisions_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."season_divisions_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."season_divisions_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."season_divisions_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."season_divisions_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."seasons_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."seasons_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."seasons_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."seasons_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."seasons_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."seasons_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."team_coach_assignments_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."team_coach_assignments_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."team_coach_assignments_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."team_coach_assignments_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."team_coach_assignments_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."team_coach_assignments_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."teams_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."teams_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."teams_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."teams_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."teams_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."teams_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."user_roles_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."user_roles_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."user_roles_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."user_roles_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."user_roles_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."user_roles_id_seq" TO "service_role";

REVOKE ALL ON TABLE "public"."audit_log" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."audit_log" TO "authenticated";

REVOKE ALL ON TABLE "public"."audit_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_log" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_log" TO "service_role";

REVOKE ALL ON TABLE "public"."division_rating_categories" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."division_rating_categories" TO "authenticated";

REVOKE ALL ON TABLE "public"."division_rating_categories" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."division_rating_categories" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."division_rating_categories" TO "service_role";

REVOKE ALL ON TABLE "public"."divisions" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."divisions" TO "authenticated";

REVOKE ALL ON TABLE "public"."divisions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."divisions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."divisions" TO "service_role";

REVOKE ALL ON TABLE "public"."evaluation_sessions" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."evaluation_sessions" TO "authenticated";

REVOKE ALL ON TABLE "public"."evaluation_sessions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluation_sessions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluation_sessions" TO "service_role";

REVOKE ALL ON TABLE "public"."evaluations" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."evaluations" TO "authenticated";

REVOKE ALL ON TABLE "public"."evaluations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluations" TO "service_role";

REVOKE ALL ON TABLE "public"."evaluator_assignments" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."evaluator_assignments" TO "authenticated";

REVOKE ALL ON TABLE "public"."evaluator_assignments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluator_assignments" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluator_assignments" TO "service_role";

REVOKE ALL ON TABLE "public"."evaluator_notes" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."evaluator_notes" TO "authenticated";

REVOKE ALL ON TABLE "public"."evaluator_notes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluator_notes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."evaluator_notes" TO "service_role";

REVOKE ALL ON TABLE "public"."experience_answers" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."experience_answers" TO "authenticated";

REVOKE ALL ON TABLE "public"."experience_answers" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."experience_answers" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."experience_answers" TO "service_role";

REVOKE ALL ON TABLE "public"."historical_evaluations" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."historical_evaluations" TO "authenticated";

REVOKE ALL ON TABLE "public"."historical_evaluations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."historical_evaluations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."historical_evaluations" TO "service_role";

REVOKE ALL ON TABLE "public"."historical_ratings" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."historical_ratings" TO "authenticated";

REVOKE ALL ON TABLE "public"."historical_ratings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."historical_ratings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."historical_ratings" TO "service_role";

REVOKE ALL ON TABLE "public"."import_batches" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."import_batches" TO "authenticated";

REVOKE ALL ON TABLE "public"."import_batches" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."import_batches" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."import_batches" TO "service_role";

REVOKE ALL ON TABLE "public"."player_seasons" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."player_seasons" TO "authenticated";

REVOKE ALL ON TABLE "public"."player_seasons" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_seasons" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_seasons" TO "service_role";

REVOKE ALL ON TABLE "public"."players" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."players" TO "authenticated";

REVOKE ALL ON TABLE "public"."players" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."players" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."players" TO "service_role";

REVOKE ALL ON TABLE "public"."private_notes" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."private_notes" TO "authenticated";

REVOKE ALL ON TABLE "public"."private_notes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."private_notes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."private_notes" TO "service_role";

REVOKE ALL ON TABLE "public"."rating_categories" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."rating_categories" TO "authenticated";

REVOKE ALL ON TABLE "public"."rating_categories" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rating_categories" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rating_categories" TO "service_role";

REVOKE ALL ON TABLE "public"."ratings" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."ratings" TO "authenticated";

REVOKE ALL ON TABLE "public"."ratings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ratings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ratings" TO "service_role";

REVOKE ALL ON TABLE "public"."season_divisions" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."season_divisions" TO "authenticated";

REVOKE ALL ON TABLE "public"."season_divisions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."season_divisions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."season_divisions" TO "service_role";

REVOKE ALL ON TABLE "public"."seasons" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."seasons" TO "authenticated";

REVOKE ALL ON TABLE "public"."seasons" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."seasons" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."seasons" TO "service_role";

REVOKE ALL ON TABLE "public"."team_coach_assignments" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."team_coach_assignments" TO "authenticated";

REVOKE ALL ON TABLE "public"."team_coach_assignments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_coach_assignments" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_coach_assignments" TO "service_role";

REVOKE ALL ON TABLE "public"."teams" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."teams" TO "authenticated";

REVOKE ALL ON TABLE "public"."teams" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."teams" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."teams" TO "service_role";

REVOKE ALL ON TABLE "public"."user_profiles" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."user_profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."user_profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."user_roles" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."user_roles" TO "authenticated";

REVOKE ALL ON TABLE "public"."user_roles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT, USAGE ON SEQUENCES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO "authenticated";
