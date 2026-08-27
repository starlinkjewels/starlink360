import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover is what makes env(safe-area-inset-*) report real
      // values, so the chrome clears the iPhone notch and home indicator.
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: "#06050a" },
      // Defaults for any route that doesn't set its own; "/" overrides the
      // title and descriptions with piece-specific copy.
      { title: "Starlink — Photorealistic Jewellery Rendering" },
      {
        name: "description",
        content: "Explore Starlink in interactive 3D — 360° turntable and live metal finishes.",
      },
      { name: "author", content: "Starlink" },
      { property: "og:title", content: "Starlink — Photorealistic Jewellery Rendering" },
      {
        property: "og:description",
        content: "Explore Starlink in interactive 3D — 360° turntable and live metal finishes.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Starlink" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500&display=swap",
      },
      /*
       * SVG first, .ico only as the fallback. A browser that understands SVG
       * takes it and renders the mark crisply at every size a tab, a bookmark
       * bar or a pinned shortcut asks for; everything else drops through to the
       * raster file. Ordering matters — the last understood `icon` link wins in
       * most browsers, so the fallback has to come first.
       */
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    /*
     * `data-theme` is never in this component's own render output — it is set
     * imperatively by the inline script below, before React ever hydrates, so
     * the flash-prevention above can run before first paint rather than one
     * React effect too late (see that script's own comment). That is exactly
     * the one situation `suppressHydrationWarning` exists for: an attribute
     * legitimately set outside React on this one element. Without it, every
     * single load hit "tree hydrated but attributes didn't match... this
     * won't be patched up" on `<html>` and React discarded and rebuilt the
     * ENTIRE client tree in response — which is what was actually behind the
     * startup shader-recompile storm this was chased down from, not any one
     * component's own effects. `suppressHydrationWarning` only covers this
     * element's own attributes, not its descendants, so it changes nothing
     * about how any real mismatch elsewhere in the tree is still reported.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/*
         * Applies the saved theme before the first paint.
         *
         * Doing this in a React effect is one frame too late: the page paints
         * dark, then flips to light, and that flash is the first thing a client
         * sees on every load. It has to be a blocking inline script in <head>.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('starlink.theme');" +
              "document.documentElement.dataset.theme=t==='dark'?'dark':'light'}" +
              "catch(e){document.documentElement.dataset.theme='light'}",
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
