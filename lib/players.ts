// Shared by the admin Players pages.
export type RegistrationRow = {
  id: number;
  season_id: number;
  evaluation_number: number | null;
  league_age: number | null;
  league_age_source: string;
  registration_source: string;
  external_player_id: string | null;
  is_coach_kid: boolean;
  // Birthdates are never read in lists (birthdate protection); has_birth_date says whether one is on file.
  players: { id: number; first_name: string; last_name: string; has_birth_date: boolean } | null;
};

export const usDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};
