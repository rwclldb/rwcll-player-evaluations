import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-card border border-border shadow-xl">
        <Image
          src="/rwcll-logo.png"
          alt="RWCLL Logo"
          width={56}
          height={56}
          className="object-contain"
          priority
        />
      </div>

      <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl md:text-5xl">
        RWCLL <span className="text-emerald-400">Player Evaluations</span>
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground text-base sm:text-lg">
        Manage evaluation sessions, track player ratings, and generate coach reports seamlessly for Redwood City Little League.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Button asChild size="lg">
          <Link href="/protected/evaluations">Start Evaluations</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/protected/reports">View Reports</Link>
        </Button>
      </div>
    </div>
  );
}