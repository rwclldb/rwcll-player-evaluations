-- Teams, team staff, coach's-kid links and sibling groups (draft step 1, decided 2026-11-19; docs/DRAFT-SPEC.md).
--
-- * Team staff roles are manager, coach and assistant_coach (head_coach becomes manager). One manager and one
--   coach per team; they are the two with the coach's-kid privilege and a seat in the draft room. A person can
--   be on teams in several divisions but only one team per division (trigger). Staff need the coach role for
--   the season.
-- * Admins and registrars of the season set up teams (can_register). Writes go through audited functions only:
--   admin_save_team, admin_delete_team, admin_set_team_staff, admin_import_teams (CSV; p_apply = false is a
--   preview that runs the same code and rolls back).
-- * coach_kid_links: a registration linked to a parent account (a coach this season). Twins are two links to
--   the same parent. Linking also sets the existing "Coach's kid" label. The draft decides later where the
--   privilege applies (divisions where the parent is Manager or Coach).
-- * sibling_groups / sibling_group_members: per season, set by admins and registrars. Never automatic.
-- * sports_connect_import_rows.account_key: SHA-256 of the lower-cased Sports Connect account email ("User
--   Email"), computed in the browser so the email never reaches the server. Set after staging with
--   set_import_account_keys. Not readable directly (no column grant). Players sharing a key are suggested as
--   siblings; a player whose key matches a season coach's sign-in email is suggested as that coach's kid.
-- * Reads for the pages: team_setup(season) and family_overview(season). Suggestions can be dismissed
--   (admin_dismiss_family_suggestion).
-- * admin_season_backup includes the new tables.

-- ---------- staff roles ----------
ALTER TABLE public.team_coach_assignments DROP CONSTRAINT team_coach_assignments_assignment_role_check;
UPDATE public.team_coach_assignments SET assignment_role = 'manager' WHERE assignment_role = 'head_coach';
ALTER TABLE public.team_coach_assignments
  ADD CONSTRAINT team_coach_assignments_assignment_role_check CHECK (assignment_role IN ('manager', 'coach', 'assistant_coach')),
  ALTER COLUMN assignment_role SET DEFAULT 'assistant_coach';
CREATE UNIQUE INDEX team_coach_assignments_one_manager ON public.team_coach_assignments (team_id) WHERE assignment_role = 'manager';
CREATE UNIQUE INDEX team_coach_assignments_one_coach ON public.team_coach_assignments (team_id) WHERE assignment_role = 'coach';

CREATE FUNCTION private.team_staff_one_team_per_division() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.team_coach_assignments o
    JOIN public.teams ot ON ot.id = o.team_id
    JOIN public.teams nt ON nt.id = NEW.team_id
    WHERE o.coach_user_id = NEW.coach_user_id AND o.id <> NEW.id
      AND ot.id <> nt.id AND ot.season_division_id = nt.season_division_id
  ) THEN
    RAISE EXCEPTION '% is already on another team in this division.',
      COALESCE((SELECT display_name FROM public.user_profiles WHERE user_id = NEW.coach_user_id), 'This person');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER team_staff_one_team_per_division BEFORE INSERT OR UPDATE ON public.team_coach_assignments
  FOR EACH ROW EXECUTE FUNCTION private.team_staff_one_team_per_division();

-- Writes only through the functions below (reads too: the pages use team_setup).
REVOKE INSERT, UPDATE, DELETE ON public.teams, public.team_coach_assignments FROM authenticated;

-- ---------- helpers ----------
CREATE FUNCTION private.assert_team_editor(p_season_id bigint) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_season_id IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can change teams and families.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id AND is_closed) THEN
    RAISE EXCEPTION 'This season is closed.';
  END IF;
END $$;

CREATE FUNCTION private.person_name(p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), u.email, 'Unknown')
  FROM auth.users u LEFT JOIN public.user_profiles p ON p.user_id = u.id WHERE u.id = p_user_id;
$$;

CREATE FUNCTION private.is_season_coach(p_user_id uuid, p_season_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND season_id = p_season_id AND role_name = 'coach');
$$;

-- The fingerprint used for Sports Connect account emails. The browser computes the same value.
CREATE FUNCTION private.email_key(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $$
  SELECT encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;

CREATE FUNCTION private.team_staff_json(p_team_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', a.coach_user_id, 'name', private.person_name(a.coach_user_id), 'role', a.assignment_role)
    ORDER BY CASE a.assignment_role WHEN 'manager' THEN 1 WHEN 'coach' THEN 2 ELSE 3 END, private.person_name(a.coach_user_id)), '[]')
  FROM public.team_coach_assignments a WHERE a.team_id = p_team_id;
$$;

CREATE FUNCTION private.player_brief(p_player_season_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT jsonb_build_object('player_season_id', ps.id, 'first_name', p.first_name, 'last_name', p.last_name,
    'league_age', ps.league_age, 'bib', ps.evaluation_number, 'is_coach_kid', ps.is_coach_kid)
  FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE ps.id = p_player_season_id;
$$;

-- ---------- teams ----------
-- Create (p_team_id NULL) or rename a team. A blank name on create becomes "Team N".
CREATE FUNCTION public.admin_save_team(p_team_id bigint, p_season_division_id bigint, p_name text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_team public.teams;
  v_season bigint;
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_n integer;
BEGIN
  IF p_team_id IS NULL THEN
    SELECT season_id INTO v_season FROM public.season_divisions WHERE id = p_season_division_id;
    IF v_season IS NULL THEN RAISE EXCEPTION 'Division not found.'; END IF;
    PERFORM private.assert_team_editor(v_season);
    IF v_name IS NULL THEN
      SELECT count(*) + 1 INTO v_n FROM public.teams WHERE season_division_id = p_season_division_id;
      WHILE EXISTS (SELECT 1 FROM public.teams WHERE season_division_id = p_season_division_id AND name = 'Team ' || v_n) LOOP
        v_n := v_n + 1;
      END LOOP;
      v_name := 'Team ' || v_n;
    END IF;
    BEGIN
      INSERT INTO public.teams (season_id, season_division_id, name) VALUES (v_season, p_season_division_id, left(v_name, 80)) RETURNING * INTO v_team;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'There is already a team called "%" in this division.', v_name;
    END;
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
    VALUES (auth.uid(), 'team_created', 'teams', v_team.id::text, to_jsonb(v_team));
    RETURN v_team.id;
  END IF;

  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found.'; END IF;
  PERFORM private.assert_team_editor(v_team.season_id);
  IF v_name IS NULL THEN RAISE EXCEPTION 'Enter a team name.'; END IF;
  IF v_name = v_team.name THEN RETURN v_team.id; END IF;
  BEGIN
    UPDATE public.teams SET name = left(v_name, 80) WHERE id = p_team_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'There is already a team called "%" in this division.', v_name;
  END;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data, after_data)
  VALUES (auth.uid(), 'team_renamed', 'teams', p_team_id::text, jsonb_build_object('name', v_team.name), jsonb_build_object('name', v_name));
  RETURN p_team_id;
END $$;

-- Delete a team that has no players. Its staff list goes with it (kept in the audit entry).
CREATE FUNCTION public.admin_delete_team(p_team_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_team public.teams;
  v_staff jsonb;
BEGIN
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found.'; END IF;
  PERFORM private.assert_team_editor(v_team.season_id);
  IF EXISTS (SELECT 1 FROM public.player_seasons WHERE team_id = p_team_id) THEN
    RAISE EXCEPTION 'This team has players. Move them off the team first.';
  END IF;
  v_staff := private.team_staff_json(p_team_id);
  DELETE FROM public.team_coach_assignments WHERE team_id = p_team_id;
  DELETE FROM public.teams WHERE id = p_team_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data)
  VALUES (auth.uid(), 'team_deleted', 'teams', p_team_id::text, to_jsonb(v_team) || jsonb_build_object('staff', v_staff));
END $$;

-- Set a team's whole staff: manager, coach (either may be NULL) and assistants.
CREATE FUNCTION public.admin_set_team_staff(p_team_id bigint, p_manager uuid, p_coach uuid, p_assistants uuid[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_team public.teams;
  v_before jsonb;
  v_after jsonb;
  v_people uuid[];
  v_person uuid;
  v_season_name text;
BEGIN
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found.'; END IF;
  PERFORM private.assert_team_editor(v_team.season_id);
  v_people := array_remove(ARRAY[p_manager, p_coach] || COALESCE(p_assistants, '{}'::uuid[]), NULL);
  IF cardinality(v_people) <> (SELECT count(DISTINCT x) FROM unnest(v_people) x) THEN
    RAISE EXCEPTION 'Each person can have only one job on a team.';
  END IF;
  SELECT name INTO v_season_name FROM public.seasons WHERE id = v_team.season_id;
  FOREACH v_person IN ARRAY v_people LOOP
    IF NOT private.is_season_coach(v_person, v_team.season_id) THEN
      RAISE EXCEPTION '% needs the coach role for % first (People page).', private.person_name(v_person), v_season_name;
    END IF;
  END LOOP;

  v_before := private.team_staff_json(p_team_id);
  DELETE FROM public.team_coach_assignments WHERE team_id = p_team_id;
  INSERT INTO public.team_coach_assignments (team_id, season_id, coach_user_id, assignment_role)
  SELECT p_team_id, v_team.season_id, x.u, x.r
  FROM (SELECT p_manager AS u, 'manager' AS r UNION ALL SELECT p_coach, 'coach'
        UNION ALL SELECT a, 'assistant_coach' FROM unnest(COALESCE(p_assistants, '{}'::uuid[])) a) x
  WHERE x.u IS NOT NULL;
  v_after := private.team_staff_json(p_team_id);
  IF v_after = v_before THEN RETURN false; END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data, after_data)
  VALUES (auth.uid(), 'team_staff_set', 'teams', p_team_id::text, jsonb_build_object('staff', v_before), jsonb_build_object('staff', v_after));
  RETURN true;
END $$;

-- Teams from a CSV. Rows: [{line, division, team, manager, coach, assistants: [emails]}]. Blank manager/coach
-- leaves the current one; listed assistants are added, never removed. Returns one result per row:
-- {line, division, team, status: new | changed | same | error, message}. p_apply = false runs the same code
-- and rolls it back, so the preview shows exactly what applying would do.
CREATE FUNCTION public.admin_import_teams(p_season_id bigint, p_rows jsonb, p_apply boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_results jsonb := '[]';
  v_row jsonb;
  v_sd bigint;
  v_team public.teams;
  v_status text;
  v_msg text;
  v_manager uuid;
  v_coach uuid;
  v_assist uuid[];
  v_email text;
  v_user uuid;
  v_before jsonb;
  v_new boolean;
  v_seen text[] := '{}';
  v_key text;
  v_applied integer := 0;
BEGIN
  PERFORM private.assert_team_editor(p_season_id);
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'Send between 1 and 500 rows.';
  END IF;
  BEGIN
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      v_status := NULL; v_msg := NULL;
      BEGIN
        SELECT sd.id INTO v_sd FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
        WHERE sd.season_id = p_season_id AND lower(d.name) = lower(btrim(v_row->>'division'));
        IF v_sd IS NULL THEN RAISE EXCEPTION '"%" isn''t a division this season.', COALESCE(v_row->>'division', ''); END IF;
        IF NULLIF(btrim(COALESCE(v_row->>'team', '')), '') IS NULL THEN RAISE EXCEPTION 'Team name is blank.'; END IF;
        v_key := v_sd || ':' || lower(btrim(v_row->>'team'));
        IF v_key = ANY (v_seen) THEN RAISE EXCEPTION 'This team is listed twice in the file.'; END IF;
        v_seen := v_seen || v_key;

        -- People by sign-in email; each must be a coach this season.
        v_manager := NULL; v_coach := NULL; v_assist := '{}';
        FOR v_email, v_status IN
          SELECT btrim(e), k FROM (
            SELECT v_row->>'manager' AS e, 'manager' AS k UNION ALL SELECT v_row->>'coach', 'coach'
            UNION ALL SELECT jsonb_array_elements_text(COALESCE(v_row->'assistants', '[]')), 'assistant_coach') x
          WHERE NULLIF(btrim(e), '') IS NOT NULL
        LOOP
          SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(v_email);
          IF v_user IS NULL THEN RAISE EXCEPTION 'No account for %. Invite them on People first.', v_email; END IF;
          IF NOT private.is_season_coach(v_user, p_season_id) THEN
            RAISE EXCEPTION '% isn''t a coach this season. Add the coach role on People first.', v_email;
          END IF;
          IF v_status = 'manager' THEN v_manager := v_user;
          ELSIF v_status = 'coach' THEN v_coach := v_user;
          ELSE v_assist := v_assist || v_user; END IF;
        END LOOP;

        SELECT * INTO v_team FROM public.teams WHERE season_division_id = v_sd AND lower(name) = lower(btrim(v_row->>'team'));
        v_new := NOT FOUND;
        IF v_new THEN
          INSERT INTO public.teams (season_id, season_division_id, name) VALUES (p_season_id, v_sd, left(btrim(v_row->>'team'), 80)) RETURNING * INTO v_team;
        END IF;
        v_before := private.team_staff_json(v_team.id);
        IF v_manager IS NOT NULL THEN
          DELETE FROM public.team_coach_assignments WHERE team_id = v_team.id AND (assignment_role = 'manager' OR coach_user_id = v_manager);
          INSERT INTO public.team_coach_assignments (team_id, season_id, coach_user_id, assignment_role) VALUES (v_team.id, p_season_id, v_manager, 'manager');
        END IF;
        IF v_coach IS NOT NULL THEN
          DELETE FROM public.team_coach_assignments WHERE team_id = v_team.id AND (assignment_role = 'coach' OR coach_user_id = v_coach);
          INSERT INTO public.team_coach_assignments (team_id, season_id, coach_user_id, assignment_role) VALUES (v_team.id, p_season_id, v_coach, 'coach');
        END IF;
        INSERT INTO public.team_coach_assignments (team_id, season_id, coach_user_id, assignment_role)
        SELECT v_team.id, p_season_id, a, 'assistant_coach' FROM unnest(v_assist) a
        WHERE NOT EXISTS (SELECT 1 FROM public.team_coach_assignments t WHERE t.team_id = v_team.id AND t.coach_user_id = a);
        IF v_new THEN v_status := 'new'; v_msg := 'New team.';
        ELSIF private.team_staff_json(v_team.id) <> v_before THEN v_status := 'changed'; v_msg := 'Staff updated.';
        ELSE v_status := 'same'; v_msg := 'Already up to date.'; END IF;
        IF v_status <> 'same' THEN
          v_applied := v_applied + 1;
          INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data, after_data)
          VALUES (auth.uid(), 'team_imported', 'teams', v_team.id::text,
                  CASE WHEN v_new THEN NULL ELSE jsonb_build_object('staff', v_before) END,
                  jsonb_build_object('name', v_team.name, 'staff', private.team_staff_json(v_team.id)));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_status := 'error'; v_msg := SQLERRM;
      END;
      v_results := v_results || jsonb_build_object('line', v_row->'line', 'division', v_row->>'division', 'team', v_row->>'team',
        'status', v_status, 'message', v_msg);
    END LOOP;
    IF NOT p_apply THEN RAISE EXCEPTION USING MESSAGE = '__preview_only__'; END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__preview_only__' THEN RAISE; END IF;
  END;
  RETURN v_results;
END $$;

-- ---------- coach's kids ----------
CREATE TABLE public.coach_kid_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_season_id, parent_user_id)
);
ALTER TABLE public.coach_kid_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.coach_kid_links FROM anon, authenticated;

CREATE FUNCTION public.admin_link_coach_kid(p_player_season_id bigint, p_parent_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_ps public.player_seasons;
BEGIN
  SELECT * INTO v_ps FROM public.player_seasons WHERE id = p_player_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player not found.'; END IF;
  PERFORM private.assert_team_editor(v_ps.season_id);
  IF NOT private.is_season_coach(p_parent_user_id, v_ps.season_id) THEN
    RAISE EXCEPTION 'The parent must be a coach this season.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.coach_kid_links WHERE player_season_id = p_player_season_id AND parent_user_id = p_parent_user_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.coach_kid_links (season_id, player_season_id, parent_user_id, created_by)
  VALUES (v_ps.season_id, p_player_season_id, p_parent_user_id, auth.uid());
  IF NOT v_ps.is_coach_kid THEN
    UPDATE public.player_seasons SET is_coach_kid = true WHERE id = p_player_season_id;
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'coach_kid_linked', 'player_seasons', p_player_season_id::text,
          jsonb_build_object('parent_user_id', p_parent_user_id, 'parent', private.person_name(p_parent_user_id), 'label_set', NOT v_ps.is_coach_kid));
END $$;

-- Removes the link only; the "Coach's kid" label stays (change it on the player's page).
CREATE FUNCTION public.admin_unlink_coach_kid(p_player_season_id bigint, p_parent_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_season bigint;
BEGIN
  SELECT season_id INTO v_season FROM public.player_seasons WHERE id = p_player_season_id;
  PERFORM private.assert_team_editor(v_season);
  DELETE FROM public.coach_kid_links WHERE player_season_id = p_player_season_id AND parent_user_id = p_parent_user_id;
  IF FOUND THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data)
    VALUES (auth.uid(), 'coach_kid_unlinked', 'player_seasons', p_player_season_id::text,
            jsonb_build_object('parent_user_id', p_parent_user_id, 'parent', private.person_name(p_parent_user_id)));
  END IF;
END $$;

-- ---------- siblings ----------
CREATE TABLE public.sibling_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sibling_group_members (
  player_season_id bigint PRIMARY KEY REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  group_id bigint NOT NULL REFERENCES public.sibling_groups(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sibling_group_members_group_idx ON public.sibling_group_members (group_id);
ALTER TABLE public.sibling_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sibling_group_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sibling_groups, public.sibling_group_members FROM anon, authenticated;

-- Put these registrations (2+, one season) in one sibling group. Groups they already belong to are joined.
CREATE FUNCTION public.admin_group_siblings(p_player_season_ids bigint[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_ids bigint[];
  v_season bigint;
  v_group bigint;
  v_before jsonb;
BEGIN
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_player_season_ids) x WHERE x IS NOT NULL;
  IF COALESCE(cardinality(v_ids), 0) < 2 THEN RAISE EXCEPTION 'Choose at least two players.'; END IF;
  IF (SELECT count(*) FROM public.player_seasons WHERE id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Player not found.';
  END IF;
  IF (SELECT count(DISTINCT season_id) FROM public.player_seasons WHERE id = ANY (v_ids)) <> 1 THEN
    RAISE EXCEPTION 'Siblings must be registered in the same season.';
  END IF;
  SELECT season_id INTO v_season FROM public.player_seasons WHERE id = v_ids[1];
  PERFORM private.assert_team_editor(v_season);

  SELECT min(group_id) INTO v_group FROM public.sibling_group_members WHERE player_season_id = ANY (v_ids);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('group_id', group_id, 'player_season_id', player_season_id)), '[]') INTO v_before
  FROM public.sibling_group_members WHERE group_id IN (SELECT group_id FROM public.sibling_group_members WHERE player_season_id = ANY (v_ids));
  IF v_group IS NULL THEN
    INSERT INTO public.sibling_groups (season_id, created_by) VALUES (v_season, auth.uid()) RETURNING id INTO v_group;
  END IF;
  -- Join other groups into this one, then add the rest.
  UPDATE public.sibling_group_members SET group_id = v_group
  WHERE group_id IN (SELECT group_id FROM public.sibling_group_members WHERE player_season_id = ANY (v_ids)) AND group_id <> v_group;
  DELETE FROM public.sibling_groups g WHERE g.season_id = v_season AND g.id <> v_group
    AND NOT EXISTS (SELECT 1 FROM public.sibling_group_members m WHERE m.group_id = g.id);
  INSERT INTO public.sibling_group_members (player_season_id, group_id, added_by)
  SELECT x, v_group, auth.uid() FROM unnest(v_ids) x ON CONFLICT (player_season_id) DO NOTHING;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data, after_data)
  VALUES (auth.uid(), 'siblings_grouped', 'sibling_groups', v_group::text, jsonb_build_object('members', v_before),
          jsonb_build_object('players', (SELECT jsonb_agg(player_season_id ORDER BY player_season_id) FROM public.sibling_group_members WHERE group_id = v_group)));
  RETURN v_group;
END $$;

-- Take one player out of their sibling group. A group left with one player is removed.
CREATE FUNCTION public.admin_remove_sibling(p_player_season_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_season bigint;
  v_group bigint;
BEGIN
  SELECT season_id INTO v_season FROM public.player_seasons WHERE id = p_player_season_id;
  PERFORM private.assert_team_editor(v_season);
  DELETE FROM public.sibling_group_members WHERE player_season_id = p_player_season_id RETURNING group_id INTO v_group;
  IF v_group IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.sibling_group_members WHERE group_id = v_group) < 2 THEN
    DELETE FROM public.sibling_groups WHERE id = v_group;
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data)
  VALUES (auth.uid(), 'sibling_removed', 'sibling_groups', v_group::text, jsonb_build_object('player_season_id', p_player_season_id));
END $$;

-- ---------- account fingerprints from the Sports Connect file ----------
ALTER TABLE public.sports_connect_import_rows
  ADD COLUMN account_key text CHECK (account_key IS NULL OR account_key ~ '^[0-9a-f]{64}$');
-- No SELECT grant on account_key: only the functions below read it.

-- p_keys: [{line, key}] for a staged batch (key = SHA-256 hex of the lower-cased account email).
CREATE FUNCTION public.set_import_account_keys(p_batch_id bigint, p_keys jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(private.batch_season(p_batch_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sports_connect_import_rows r SET account_key = k.key
  FROM jsonb_to_recordset(COALESCE(p_keys, '[]')) AS k(line integer, key text)
  WHERE r.import_batch_id = p_batch_id AND r.source_row_number = k.line AND k.key ~ '^[0-9a-f]{64}$';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Each registration's latest account fingerprint (from the row that created it or was compared with it).
CREATE FUNCTION private.season_account_keys(p_season_id bigint)
RETURNS TABLE (player_season_id bigint, account_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT DISTINCT ON (ps.id) ps.id, r.account_key
  FROM public.player_seasons ps
  JOIN public.sports_connect_import_rows r ON r.committed_player_season_id = ps.id OR r.existing_player_season_id = ps.id
  WHERE ps.season_id = p_season_id AND r.account_key IS NOT NULL
  ORDER BY ps.id, r.id DESC;
$$;

CREATE TABLE public.family_suggestion_dismissals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('siblings', 'coach_kid')),
  key text NOT NULL,
  dismissed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, kind, key)
);
ALTER TABLE public.family_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.family_suggestion_dismissals FROM anon, authenticated;

-- Suggestions not yet acted on. Siblings: 2+ registrations sharing an account fingerprint and not already all in
-- one group (key = their ids). Coach's kids: a registration whose fingerprint matches a season coach's sign-in
-- email and isn't linked to them (key = player_season_id:user_id).
CREATE FUNCTION private.family_suggestions(p_season_id bigint)
RETURNS TABLE (kind text, key text, player_season_ids bigint[], parent_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  WITH k AS (SELECT * FROM private.season_account_keys(p_season_id)),
  sib AS (
    SELECT array_agg(k.player_season_id ORDER BY k.player_season_id) AS ids
    FROM k GROUP BY k.account_key HAVING count(*) >= 2
  ),
  sib_open AS (
    SELECT ids FROM sib
    WHERE (SELECT count(DISTINCT m.group_id) FILTER (WHERE m.group_id IS NOT NULL) = 1 AND count(m.group_id) = cardinality(ids)
           FROM unnest(ids) i LEFT JOIN public.sibling_group_members m ON m.player_season_id = i) IS NOT TRUE
  ),
  coaches AS (
    SELECT DISTINCT u.id, private.email_key(u.email) AS email_key
    FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.season_id = p_season_id AND ur.role_name = 'coach' AND u.email IS NOT NULL
  )
  SELECT 'siblings', array_to_string(ids, ','), ids, NULL::uuid FROM sib_open
  WHERE NOT EXISTS (SELECT 1 FROM public.family_suggestion_dismissals d
                    WHERE d.season_id = p_season_id AND d.kind = 'siblings' AND d.key = array_to_string(ids, ','))
  UNION ALL
  SELECT 'coach_kid', k.player_season_id || ':' || c.id, ARRAY[k.player_season_id], c.id
  FROM k JOIN coaches c ON c.email_key = k.account_key
  WHERE NOT EXISTS (SELECT 1 FROM public.coach_kid_links l WHERE l.player_season_id = k.player_season_id AND l.parent_user_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.family_suggestion_dismissals d
                    WHERE d.season_id = p_season_id AND d.kind = 'coach_kid' AND d.key = k.player_season_id || ':' || c.id);
$$;

CREATE FUNCTION public.admin_dismiss_family_suggestion(p_season_id bigint, p_kind text, p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  PERFORM private.assert_team_editor(p_season_id);
  IF p_kind NOT IN ('siblings', 'coach_kid') OR NULLIF(btrim(COALESCE(p_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Unknown suggestion.';
  END IF;
  INSERT INTO public.family_suggestion_dismissals (season_id, kind, key, dismissed_by)
  VALUES (p_season_id, p_kind, p_key, auth.uid()) ON CONFLICT (season_id, kind, key) DO NOTHING;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'family_suggestion_dismissed', 'seasons', p_season_id::text, jsonb_build_object('kind', p_kind, 'key', p_key));
END $$;

-- ---------- reads for the pages ----------
-- Teams page: every division of the season with its teams, staff and the staff's linked kids, plus the season's
-- coaches for the pickers (emails only for admins).
CREATE FUNCTION public.team_setup(p_season_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_admin boolean := public.is_admin();
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can see team setup.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'divisions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'season_division_id', sd.id, 'name', d.name, 'min_age', sd.min_age, 'max_age', sd.max_age,
        'teams', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name,
            'players', (SELECT count(*) FROM public.player_seasons ps WHERE ps.team_id = t.id),
            'staff', private.team_staff_json(t.id),
            'kids', (SELECT COALESCE(jsonb_agg(private.player_brief(l.player_season_id) || jsonb_build_object('parent_user_id', l.parent_user_id)
                                     ORDER BY l.player_season_id), '[]')
                     FROM public.coach_kid_links l JOIN public.team_coach_assignments a ON a.coach_user_id = l.parent_user_id
                     WHERE a.team_id = t.id AND a.assignment_role IN ('manager', 'coach') AND l.season_id = t.season_id)
          ) ORDER BY t.name), '[]')
          FROM public.teams t WHERE t.season_division_id = sd.id)
      ) ORDER BY d.sort_order, d.name), '[]')
      FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
      WHERE sd.season_id = p_season_id),
    'coaches', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'name', private.person_name(u.id), 'email', CASE WHEN v_admin THEN u.email END,
        'divisions', (SELECT COALESCE(jsonb_agg(d.name ORDER BY d.sort_order), '[]') FROM public.coach_divisions cd
                      JOIN public.divisions d ON d.id = cd.division_id WHERE cd.user_id = u.id AND cd.season_id = p_season_id),
        'teams', (SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', a.team_id, 'season_division_id', t.season_division_id, 'role', a.assignment_role)), '[]')
                  FROM public.team_coach_assignments a JOIN public.teams t ON t.id = a.team_id WHERE a.coach_user_id = u.id AND a.season_id = p_season_id)
      ) ORDER BY lower(private.person_name(u.id))), '[]')
      FROM auth.users u
      WHERE u.id IN (SELECT user_id FROM public.user_roles WHERE season_id = p_season_id AND role_name = 'coach'))
  );
END $$;

-- Coach's kids and siblings page: the season's coach's kids (labelled or linked) with their parents, sibling
-- groups, open suggestions, and lists for the pickers.
CREATE FUNCTION public.family_overview(p_season_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can see coach''s kids and siblings.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'coach_kids', (
      SELECT COALESCE(jsonb_agg(private.player_brief(ps.id) || jsonb_build_object(
        'parents', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'user_id', l.parent_user_id, 'name', private.person_name(l.parent_user_id),
                      'teams', (SELECT COALESCE(jsonb_agg(jsonb_build_object('team', t.name, 'division', d.name, 'role', a.assignment_role)
                                                          ORDER BY d.sort_order), '[]')
                                FROM public.team_coach_assignments a JOIN public.teams t ON t.id = a.team_id
                                JOIN public.season_divisions sd ON sd.id = t.season_division_id JOIN public.divisions d ON d.id = sd.division_id
                                WHERE a.coach_user_id = l.parent_user_id AND a.season_id = p_season_id))
                    ORDER BY l.created_at), '[]')
                    FROM public.coach_kid_links l WHERE l.player_season_id = ps.id))
        ORDER BY p.last_name, p.first_name), '[]')
      FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
      WHERE ps.season_id = p_season_id
        AND (ps.is_coach_kid OR EXISTS (SELECT 1 FROM public.coach_kid_links l WHERE l.player_season_id = ps.id))),
    'sibling_groups', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('group_id', g.id,
        'players', (SELECT jsonb_agg(private.player_brief(m.player_season_id) ORDER BY m.player_season_id)
                    FROM public.sibling_group_members m WHERE m.group_id = g.id)) ORDER BY g.id), '[]')
      FROM public.sibling_groups g WHERE g.season_id = p_season_id),
    'suggestions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.kind, 'key', s.key,
        'players', (SELECT jsonb_agg(private.player_brief(i) ORDER BY i) FROM unnest(s.player_season_ids) i),
        'parent', CASE WHEN s.parent_user_id IS NULL THEN NULL
                       ELSE jsonb_build_object('user_id', s.parent_user_id, 'name', private.person_name(s.parent_user_id)) END)
        ORDER BY s.kind DESC, s.key), '[]')
      FROM private.family_suggestions(p_season_id) s),
    'players', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('player_season_id', ps.id, 'first_name', p.first_name, 'last_name', p.last_name,
        'league_age', ps.league_age, 'bib', ps.evaluation_number) ORDER BY p.last_name, p.first_name), '[]')
      FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE ps.season_id = p_season_id),
    'coaches', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', private.person_name(x.user_id))
        ORDER BY lower(private.person_name(x.user_id))), '[]')
      FROM (SELECT DISTINCT user_id FROM public.user_roles WHERE season_id = p_season_id AND role_name = 'coach') x)
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_save_team(bigint, bigint, text), public.admin_delete_team(bigint),
  public.admin_set_team_staff(bigint, uuid, uuid, uuid[]), public.admin_import_teams(bigint, jsonb, boolean),
  public.admin_link_coach_kid(bigint, uuid), public.admin_unlink_coach_kid(bigint, uuid),
  public.admin_group_siblings(bigint[]), public.admin_remove_sibling(bigint),
  public.set_import_account_keys(bigint, jsonb), public.admin_dismiss_family_suggestion(bigint, text, text),
  public.team_setup(bigint), public.family_overview(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_team(bigint, bigint, text), public.admin_delete_team(bigint),
  public.admin_set_team_staff(bigint, uuid, uuid, uuid[]), public.admin_import_teams(bigint, jsonb, boolean),
  public.admin_link_coach_kid(bigint, uuid), public.admin_unlink_coach_kid(bigint, uuid),
  public.admin_group_siblings(bigint[]), public.admin_remove_sibling(bigint),
  public.set_import_account_keys(bigint, jsonb), public.admin_dismiss_family_suggestion(bigint, text, text),
  public.team_setup(bigint), public.family_overview(bigint) TO authenticated;
REVOKE ALL ON FUNCTION private.assert_team_editor(bigint), private.person_name(uuid), private.is_season_coach(uuid, bigint),
  private.email_key(text), private.team_staff_json(bigint), private.player_brief(bigint), private.season_account_keys(bigint),
  private.family_suggestions(bigint) FROM PUBLIC, anon, authenticated;

-- ---------- season backup: add the new tables ----------
CREATE OR REPLACE FUNCTION public.admin_season_backup(p_season_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_tables jsonb;
  v_counts jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id) THEN
    RAISE EXCEPTION 'Season not found.';
  END IF;

  CREATE TEMP TABLE backup_registrations ON COMMIT DROP AS
    SELECT ps.id, ps.player_id FROM public.player_seasons ps WHERE ps.season_id = p_season_id;
  CREATE TEMP TABLE backup_sessions ON COMMIT DROP AS
    SELECT es.id FROM public.evaluation_sessions es WHERE es.season_id = p_season_id;
  CREATE TEMP TABLE backup_evaluations ON COMMIT DROP AS
    SELECT e.id, e.evaluator_user_id FROM public.evaluations e
    WHERE e.evaluation_session_id IN (SELECT id FROM backup_sessions)
       OR e.player_season_id IN (SELECT id FROM backup_registrations);
  CREATE TEMP TABLE backup_history ON COMMIT DROP AS
    SELECT h.id FROM public.historical_evaluations h WHERE h.player_id IN (SELECT player_id FROM backup_registrations);
  CREATE TEMP TABLE backup_users ON COMMIT DROP AS
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.season_id = p_season_id OR ur.role_name = 'administrator'
    UNION SELECT evaluator_user_id FROM backup_evaluations
    UNION SELECT ea.evaluator_user_id FROM public.evaluator_assignments ea WHERE ea.evaluation_session_id IN (SELECT id FROM backup_sessions)
    UNION SELECT cd.user_id FROM public.coach_divisions cd WHERE cd.season_id = p_season_id;

  v_tables := jsonb_build_object(
    'seasons', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.seasons t WHERE t.id = p_season_id),
    'divisions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.divisions t),
    'season_divisions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.season_divisions t WHERE t.season_id = p_season_id),
    'rating_categories', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.rating_categories t),
    -- Never the birthdate itself: only whether one is on file.
    'players', (SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'date_of_birth' ORDER BY t.id), '[]') FROM public.players t
                WHERE t.id IN (SELECT player_id FROM backup_registrations)),
    'player_seasons', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_seasons t WHERE t.season_id = p_season_id),
    'evaluation_sessions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluation_sessions t WHERE t.season_id = p_season_id),
    'evaluation_session_events', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluation_session_events t
                                  WHERE t.evaluation_session_id IN (SELECT id FROM backup_sessions)),
    'evaluator_assignments', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluator_assignments t
                              WHERE t.evaluation_session_id IN (SELECT id FROM backup_sessions)),
    'evaluations', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluations t WHERE t.id IN (SELECT id FROM backup_evaluations)),
    'ratings', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.ratings t WHERE t.evaluation_id IN (SELECT id FROM backup_evaluations)),
    'experience_answers', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.experience_answers t
                           WHERE t.evaluation_id IN (SELECT id FROM backup_evaluations)),
    'evaluator_notes', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluator_notes t
                        WHERE t.evaluation_id IN (SELECT id FROM backup_evaluations)),
    'historical_evaluations', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.historical_evaluations t
                               WHERE t.id IN (SELECT id FROM backup_history)),
    'historical_ratings', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.historical_ratings t
                           WHERE t.historical_evaluation_id IN (SELECT id FROM backup_history)),
    'player_checkins', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_checkins t
                        WHERE t.player_season_id IN (SELECT id FROM backup_registrations)),
    'player_calls', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_calls t
                     WHERE t.player_season_id IN (SELECT id FROM backup_registrations)),
    'player_exemptions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_exemptions t
                          WHERE t.player_season_id IN (SELECT id FROM backup_registrations)),
    'teams', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.teams t WHERE t.season_id = p_season_id),
    'team_coach_assignments', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.team_coach_assignments t WHERE t.season_id = p_season_id),
    'coach_kid_links', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.coach_kid_links t WHERE t.season_id = p_season_id),
    'sibling_groups', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.sibling_groups t WHERE t.season_id = p_season_id),
    'sibling_group_members', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.player_season_id), '[]') FROM public.sibling_group_members t
                               WHERE t.group_id IN (SELECT id FROM public.sibling_groups WHERE season_id = p_season_id)),
    'user_roles', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.user_roles t
                   WHERE t.season_id = p_season_id OR t.role_name = 'administrator'),
    'coach_divisions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.coach_divisions t WHERE t.season_id = p_season_id),
    'accounts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'user_id', u.id, 'email', u.email, 'display_name', p.display_name, 'created_at', u.created_at,
                   'last_sign_in_at', u.last_sign_in_at, 'disabled', (u.banned_until IS NOT NULL AND u.banned_until > now()))
                   ORDER BY lower(COALESCE(p.display_name, u.email))), '[]')
                 FROM auth.users u LEFT JOIN public.user_profiles p ON p.user_id = u.id
                 WHERE u.id IN (SELECT user_id FROM backup_users))
  );

  SELECT jsonb_object_agg(key, jsonb_array_length(value)) INTO v_counts FROM jsonb_each(v_tables);
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'season_backup_downloaded', 'seasons', p_season_id::text, NULL, NULL, jsonb_build_object('rows', v_counts));

  DROP TABLE backup_registrations, backup_sessions, backup_evaluations, backup_history, backup_users;
  RETURN jsonb_build_object('made_at', now(), 'season_id', p_season_id, 'tables', v_tables);
END;
$$;

