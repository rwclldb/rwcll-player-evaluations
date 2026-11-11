// Shared by the admin Players pages.
export type RegistrationRow = {
  id: number;
  season_id: number;
  evaluation_number: number | null;
  league_age: number | null;
  league_age_source: string;
  registration_source: string;
  external_player_id: string | null;
  players: { id: number; first_name: string; last_name: string; date_of_birth: string | null } | null;
};

export const usDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};
