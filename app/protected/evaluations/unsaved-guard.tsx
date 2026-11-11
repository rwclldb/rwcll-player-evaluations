"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

// Marks the scoring form as changed so navigation buttons can warn before discarding edits.
export function DirtyTracker({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const markDirty = () => { form.dataset.dirty = "true"; };
    const clear = () => { delete form.dataset.dirty; };
    form.addEventListener("change", markDirty);
    form.addEventListener("input", markDirty); // typing in the notes box
    form.addEventListener("submit", clear);
    return () => {
      form.removeEventListener("change", markDirty);
      form.removeEventListener("input", markDirty);
      form.removeEventListener("submit", clear);
    };
  }, [formId]);
  return null;
}

export function GuardedLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        const dirty = document.querySelector('form[data-dirty="true"]');
        if (dirty && !window.confirm("You have changes that are not saved. Leave this player without saving?")) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </Link>
  );
}
