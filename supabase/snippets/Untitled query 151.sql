SELECT
    u.email,
    ur.role_name,
    ur.season_id
FROM public.user_roles AS ur
JOIN auth.users AS u ON u.id = ur.user_id
WHERE ur.role_name = 'administrator'
  AND ur.season_id IS NULL;