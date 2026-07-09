import { createRootRouteWithContext, Outlet, HeadContent, Scripts, Link, useRouterState, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ActiveBrandProvider } from "@/lib/active-brand";
import { ExpertSwitcher } from "@/components/expert-switcher";
import { NotificationsProvider } from "@/lib/notifications";
import { RouteProgress } from "@/components/route-progress";
import { CopilotLauncher } from "@/components/copilot/CopilotLauncher";
import appCss from "../styles.css?url";
import faviconUrl from "@/assets/megacrm-logo.png?url";

const PUBLIC_ROUTES = new Set(["/login", "/cadastro", "/definir-senha", "/privacidade", "/docs"]);

interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MegaCRM" },
      { name: "description", content: "CRM de atendimento WhatsApp multi-workspace" },
      { property: "og:title", content: "MegaCRM" },
      { name: "twitter:title", content: "MegaCRM" },
      { property: "og:description", content: "CRM de atendimento WhatsApp multi-workspace" },
      { name: "twitter:description", content: "CRM de atendimento WhatsApp multi-workspace" },
      { property: "og:image", content: faviconUrl },
      { name: "twitter:image", content: faviconUrl },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: faviconUrl },
      { rel: "apple-touch-icon", href: faviconUrl },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" },
      { rel: "preconnect", href: "https://cdn.gpteng.co", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: RootErrorComponent,
});

function RootErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  // eslint-disable-next-line no-console
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-foreground">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Não foi possível carregar esta página agora. Tente novamente em instantes.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              void router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Ir para o início
          </Link>
        </div>
      </div>
    </div>
  );
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AppShell() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const isPublic = PUBLIC_ROUTES.has(path);

  const mustSetPassword = !!session?.user?.user_metadata?.must_set_password;

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (session && mustSetPassword && path !== "/definir-senha") {
      navigate({ to: "/definir-senha", replace: true });
      return;
    }
    if (session && !mustSetPassword && path === "/") {
      navigate({ to: "/admin/dashboard", replace: true });
    }
  }, [loading, session, isPublic, navigate, mustSetPassword, path]);

  if (isPublic) return <Outlet />;

  // Show full-screen spinner while:
  // - auth is hydrating
  // - no session (about to redirect to /login)
  // - logged in but currently on "/" (about to redirect to /admin/dashboard)
  // - must set password and not yet on /definir-senha
  const isRedirecting =
    (session && !mustSetPassword && path === "/") ||
    (session && mustSetPassword && path !== "/definir-senha");
  if (loading || !session || isRedirecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ActiveBrandProvider>
      <NotificationsProvider>
        <SidebarProvider>
          <RouteProgress />
          <div className="flex min-h-screen w-full">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex h-12 items-center justify-between gap-2 border-b border-border bg-card px-3">
                <SidebarTrigger className="h-8 w-8 text-muted-foreground hover:bg-muted/60" />
                <ExpertSwitcher />
              </header>
              <main className="flex-1 overflow-auto bg-background">
                <Outlet />
              </main>
            </div>
          </div>
          <CopilotLauncher />
        </SidebarProvider>
      </NotificationsProvider>
    </ActiveBrandProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
