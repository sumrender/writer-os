/// <reference types="vite/client" />
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Writer OS — Benchmark" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en" className="h-full bg-zinc-950 text-zinc-100 antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-full font-sans">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <header className="mb-8 border-b border-zinc-800 pb-4">
            <h1 className="text-xl font-semibold tracking-tight">Writer OS Benchmark</h1>
            <p className="text-sm text-zinc-400">
              Configure, run, and inspect mini-book Extraction benchmarks.
            </p>
          </header>
          <Outlet />
        </div>
        <Scripts />
      </body>
    </html>
  );
}
