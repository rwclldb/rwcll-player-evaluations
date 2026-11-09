"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyGlobalPrimaryEventSchedule } from "./actions";

type SessionRow = {
  id: number;
  league_age: number | null;
  status: string;
};

type EventRow = {
  evaluation_session_id: number;
  event_type: string;
};

export function GlobalPrimarySchedule({
  seasonId,
  seasonName,
  seasonClosed,
  sessions,
  events,
}: {
  seasonId: number;
  seasonName: string;
  seasonClosed: boolean;
  sessions: SessionRow[];
  events: EventRow[];
}) {
  const [eventDate, setEventDate] = useState("2027-02-20");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const primarySessionIds = useMemo(
    () => new Set(events.filter((event) => event.event_type === "primary").map((event) => event.evaluation_session_id)),
    [events],
  );
  const eligible = sessions.filter((session) => session.status === "setup" && !primarySessionIds.has(session.id));
  const setupWithPrimary = sessions.filter((session) => session.status === "setup" && primarySessionIds.has(session.id));
  const nonSetup = sessions.filter((session) => session.status !== "setup");

  return (
    <section className="mb-5 rounded-lg border border-emerald-700/30 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Global primary event schedule</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Set a common schedule for eligible Setup sessions in {seasonName}. Existing primary schedules are preserved, and Open or Locked sessions are never changed. Makeup events remain individual.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-xs text-muted-foreground">Date
          <input name="eventDate" type="date" required value={eventDate} onChange={(e) => setEventDate(e.target.value)} disabled={seasonClosed} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Start time
          <input name="startTime" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={seasonClosed} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">End time
          <input name="endTime" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={seasonClosed} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm text-foreground" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2 xl:col-span-2">Location (required)
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} required disabled={seasonClosed} placeholder="Field, park, or facility" className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2 xl:col-span-5">Optional notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} disabled={seasonClosed} placeholder="Arrival instructions or what to bring" className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={seasonClosed || !eventDate || !startTime || !endTime || endTime <= startTime || !location.trim()} onClick={() => setShowPreview(true)}>
          Preview eligible sessions
        </Button>
        {seasonClosed && <span className="text-xs text-muted-foreground">This season is closed.</span>}
      </div>

      {showPreview && (
        <div className="rounded-md border border-border bg-card p-3 space-y-3">
          <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
            Preview — no changes have been made yet
          </div>
          <p className="text-xs text-muted-foreground">{eligible.length} session(s) will receive this primary schedule. The server will re-check eligibility when you apply it.</p>
          {eligible.length > 0 ? (
            <ul className="grid gap-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
              {eligible.map((session) => (
                <li key={session.id} className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                  Age {session.league_age} · Session #{session.id}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No eligible sessions. Every Setup session may already have a primary event, or there are no Setup sessions.</p>
          )}
          {setupWithPrimary.length > 0 && <p className="text-xs text-muted-foreground">Skipped {setupWithPrimary.length} Setup session(s) with an existing primary schedule; those schedules will not be overwritten.</p>}
          {nonSetup.length > 0 && <p className="text-xs text-muted-foreground">Skipped {nonSetup.length} Open or Locked session(s).</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPreview(false)}>Cancel preview</Button>
            <form action={applyGlobalPrimaryEventSchedule}>
              <input type="hidden" name="seasonId" value={seasonId} />
              <input type="hidden" name="eventDate" value={eventDate} />
              <input type="hidden" name="startTime" value={startTime} />
              <input type="hidden" name="endTime" value={endTime} />
              <input type="hidden" name="location" value={location} />
              <input type="hidden" name="notes" value={notes} />
              <Button type="submit" size="sm" disabled={seasonClosed || eligible.length === 0} className="bg-emerald-600 text-white hover:bg-emerald-500">Apply to {eligible.length} session(s)</Button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
