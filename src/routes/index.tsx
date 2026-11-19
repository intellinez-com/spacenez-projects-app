import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { STAGES } from "@/lib/constants";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Spacenez Track — Your interior project, stage by stage" },
      { name: "description", content: "Track your Spacenez interior project from planning, 2D and 3D design to execution and handover." },
      { property: "og:title", content: "Spacenez Track" },
      { property: "og:description", content: "Track your Spacenez interior project from planning to handover." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <BrandMark className="h-9" alt="Spacenez Track" />
        <Button asChild>
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-16">
        <p className="eyebrow">Client & partner portal</p>
        <h1 className="mt-4 max-w-3xl text-5xl leading-[1.05] md:text-7xl">
          Every room, every drawing, every step — <em className="text-oak">in one place.</em>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Follow your project from the first brief through 2D layouts, 3D visualisation and interior
          design, all the way to execution and handover.
        </p>
        <Button asChild size="lg" className="mt-10">
          <Link to="/auth">Open my projects</Link>
        </Button>

        <ol className="mt-20 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {STAGES.map((s, i) => (
            <li key={s.key} className="bg-card p-5">
              <span className="font-display text-2xl text-oak">{String(i + 1).padStart(2, "0")}</span>
              <p className="mt-2 text-sm font-medium">{s.label}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
