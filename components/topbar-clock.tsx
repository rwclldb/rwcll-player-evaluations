"use client";

import { useEffect, useState } from "react";

export function TopbarClock() {
  const [timeStr, setTimeStr] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!timeStr) return null;

  return (
    <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded bg-background border border-border text-xs font-mono text-emerald-400">
      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
      {timeStr}
    </div>
  );
}