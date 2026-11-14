import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { guideFor } from "@/lib/help";
import { PrintButton } from "../../roster/print-button";
import { GuideView } from "../guide-view";

// One guide. Every signed-in person can read every guide (admins hand them out); the guides hold no league data.
export default async function GuidePage({ params }: { params: Promise<{ guide: string }> }) {
  const { guide: key } = await params;
  const guide = guideFor(key);
  if (!guide) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{"@media print { @page { size: portrait; margin: 0.6in; } }"}</style>
      <div className="flex items-center gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/help"><ArrowLeft className="mr-1 h-4 w-4" /> Help</Link>
        </Button>
        <PrintButton label="Print or save as PDF" />
      </div>
      <GuideView guide={guide} />
    </div>
  );
}
