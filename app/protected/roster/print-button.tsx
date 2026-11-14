"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => window.print()}>
      <Printer className="mr-1 h-4 w-4" /> {label}
    </Button>
  );
}
