import { Button } from "@/components/ui/button";

export function DeployButton() {
  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href="https://vercel.com/new"
        target="_blank"
        rel="noreferrer"
        className="text-xs font-mono"
      >
        Deploy
      </a>
    </Button>
  );
}