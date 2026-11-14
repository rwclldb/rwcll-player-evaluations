import { Fragment, type ReactNode } from "react";
import { Lightbulb } from "lucide-react";
import type { HelpBlock, HelpGuide } from "@/lib/help";

// [[Label]] becomes a button-style label; **text** becomes bold.
function inline(text: string): ReactNode {
  return text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("[[")) {
      return (
        <span key={i} className="whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-[0.92em] font-semibold text-foreground print:!border-black print:!text-black">
          {part.slice(2, -2)}
        </span>
      );
    }
    if (part.startsWith("**")) return <strong key={i} className="font-semibold text-foreground print:!text-black">{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Block({ block }: { block: HelpBlock }) {
  if (typeof block === "string") return <p>{inline(block)}</p>;
  if ("steps" in block) return <ol className="list-decimal space-y-1.5 pl-6">{block.steps.map((s, i) => <li key={i}>{inline(s)}</li>)}</ol>;
  if ("list" in block) return <ul className="list-disc space-y-1.5 pl-6">{block.list.map((s, i) => <li key={i}>{inline(s)}</li>)}</ul>;
  return (
    <p className="flex gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 print:border-black">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300 print:hidden" />
      <span>{inline(block.tip)}</span>
    </p>
  );
}

export function GuideView({ guide }: { guide: HelpGuide }) {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300 print:text-[11pt] print:!text-black">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground print:text-black">RWCLL Player Evaluations · {guide.audience}</p>
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl print:text-black">{guide.title}</h1>
        <p className="text-base">{guide.intro}</p>
      </header>
      <nav aria-label="Contents" className="rounded-lg border border-border bg-card p-3 print:hidden">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contents</p>
        <ol className="grid gap-1 sm:grid-cols-2">
          {guide.sections.map((s, i) => (
            <li key={s.id}><a href={`#${s.id}`} className="text-foreground underline-offset-2 hover:underline">{i + 1}. {s.title}</a></li>
          ))}
        </ol>
      </nav>
      {guide.sections.map((s, i) => (
        <section key={s.id} id={s.id} className="scroll-mt-20 space-y-3">
          <h2 className="text-lg font-bold text-foreground print:break-after-avoid print:!text-black">{i + 1}. {s.title}</h2>
          {s.blocks.map((b, j) => <Block key={j} block={b} />)}
        </section>
      ))}
    </article>
  );
}
