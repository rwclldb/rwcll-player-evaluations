// lib/constants/league.ts

export const LEAGUE_DIVISIONS = [
  "AA",
  "AAA",
  "Majors",
  "Juniors",
  "Seniors",
] as const;

export type LeagueDivision = (typeof LEAGUE_DIVISIONS)[number];

export const LITTLE_LEAGUE_AGES = [
  "LL7",
  "LL8",
  "LL9",
  "LL10",
  "LL11",
  "LL12",
  "LL13",
  "LL14",
  "LL15",
  "LL16",
] as const;

export type LittleLeagueAge = (typeof LITTLE_LEAGUE_AGES)[number];