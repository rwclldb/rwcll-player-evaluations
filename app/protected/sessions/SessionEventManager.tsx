import { CalendarPlus, MapPin, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteEvaluationSessionEvent,
  saveEvaluationSessionEvent,
} from "./actions";

type SessionEvent = {
  id: number;
  evaluation_session_id: number;
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string | null;
};

function EventForm({
  sessionId,
  event,
  eventType,
  disabled,
}: {
  sessionId: number;
  event?: SessionEvent;
  eventType: "primary" | "makeup";
  disabled: boolean;
}) {
  const timeValue = (value?: string) => value?.slice(0, 5) ?? "";

  return (
    <div className="rounded-md border border-border bg-background p-3">
    <form action={saveEvaluationSessionEvent} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="eventType" value={event?.event_type ?? eventType} />
      {event && <input type="hidden" name="eventId" value={event.id} />}
      <div className="md:col-span-2 xl:col-span-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {event ? (event.event_type === "primary" ? "Primary event" : "Makeup event") : (eventType === "primary" ? "Schedule primary event" : "Add makeup event")}
        </p>
        {event && <span className="text-[11px] font-mono text-muted-foreground">Event #{event.id}</span>}
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Date
        <input name="eventDate" type="date" required disabled={disabled} defaultValue={event?.event_date ?? ""} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm text-foreground" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Start time
        <input name="startTime" type="time" required disabled={disabled} defaultValue={timeValue(event?.start_time)} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm text-foreground" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        End time
        <input name="endTime" type="time" required disabled={disabled} defaultValue={timeValue(event?.end_time)} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm text-foreground" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground md:col-span-2 xl:col-span-2">
        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Location</span>
        <input name="location" type="text" required maxLength={200} disabled={disabled} defaultValue={event?.location ?? ""} placeholder="Field, park, or facility" className="min-h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground md:col-span-2 xl:col-span-3">
        Optional notes
        <textarea name="notes" rows={2} maxLength={1000} disabled={disabled} defaultValue={event?.notes ?? ""} placeholder="Arrival instructions or what to bring" className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
      </label>
      <div className="md:col-span-2 xl:col-span-3 flex flex-wrap items-center justify-end gap-2">
        <Button type="submit" size="sm" disabled={disabled} className="bg-emerald-600 text-white hover:bg-emerald-500">
          {event ? <Save className="mr-1 h-3.5 w-3.5" /> : <CalendarPlus className="mr-1 h-3.5 w-3.5" />}
          {event ? "Save changes" : "Schedule event"}
        </Button>
      </div>
    </form>
    {event && (
      <form action={deleteEvaluationSessionEvent} className="mt-2 flex justify-end">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="eventId" value={event.id} />
        <Button type="submit" variant="outline" size="sm" disabled={disabled} className="text-rose-700 dark:text-rose-300">
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove event
        </Button>
      </form>
    )}
    </div>
  );
}

export function SessionEventManager({
  sessionId,
  events,
  disabled,
}: {
  sessionId: number;
  events: SessionEvent[];
  disabled: boolean;
}) {
  const primary = events.find((event) => event.event_type === "primary");
  const makeups = events.filter((event) => event.event_type === "makeup");

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Event schedule</h4>
        <p className="text-xs text-muted-foreground">
          {primary ? "Primary event scheduled" : "Primary event required before opening"} · {makeups.length} makeup event{makeups.length === 1 ? "" : "s"}
        </p>
      </div>
      {primary ? (
        <EventForm sessionId={sessionId} event={primary} eventType="primary" disabled={disabled} />
      ) : (
        <EventForm sessionId={sessionId} eventType="primary" disabled={disabled} />
      )}
      {makeups.map((event) => (
        <EventForm key={event.id} sessionId={sessionId} event={event} eventType="makeup" disabled={disabled} />
      ))}
      <EventForm sessionId={sessionId} eventType="makeup" disabled={disabled} />
      {disabled && <p className="text-xs text-muted-foreground">Event scheduling is read-only after a session is opened or locked, or when its season is closed.</p>}
    </div>
  );
}
