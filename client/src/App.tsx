import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { FilterProvider } from "@/context/FilterContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { BreakAlertOverlay } from "@/components/BreakAlertOverlay";
import { NotificationOverlay } from "@/components/NotificationOverlay";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import Login from "@/pages/login";

const Home = lazy(() => import("@/pages/home"));
const Operacional = lazy(() => import("@/pages/operacional"));
const RegistrosExpirados = lazy(() => import("@/pages/registros-expirados"));
const Metodologia = lazy(() => import("@/pages/metodologia"));
const Sobre = lazy(() => import("@/pages/sobre"));
const ManutencaoPreventiva = lazy(() => import("@/pages/manutencao-preventiva"));
const PesquisaSatisfacao = lazy(() => import("@/pages/pesquisa-satisfacao"));
const Gestao = lazy(() => import("@/pages/gestao"));
const GestaoOpenAI = lazy(() => import("@/pages/gestao-openai"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Carregando página">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-[420px] max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-32 rounded-2xl" key={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
      <span className="sr-only">Carregando conteúdo...</span>
    </div>
  );
}

function ProtectedRouter() {
  return (
    <Switch>
      <Route path="/">
        <Home />
      </Route>
      <Route path="/operacional" component={Operacional} />
      <Route path="/registros-expirados" component={RegistrosExpirados} />
      <Route path="/manutencao-preventiva" component={ManutencaoPreventiva} />
      <Route path="/pesquisa-satisfacao" component={PesquisaSatisfacao} />
      <Route path="/metodologia" component={Metodologia} />
      <Route path="/sobre" component={Sobre} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const [location] = useLocation();
  const sidebarStyle = {
    "--sidebar-width": "17rem",
    "--sidebar-width-icon": "4rem",
  };

  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="sidebar-inset"] [data-radix-scroll-area-viewport]'
    );
    viewport?.scrollTo({ top: 0 });

    window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }, [location]);

  return (
    <SidebarProvider
      style={sidebarStyle as React.CSSProperties}
      className="h-svh overflow-hidden"
    >
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform focus:translate-y-0"
      >
        Pular para o conteúdo
      </a>
      <AppSidebar />
      <SidebarInset className="app-canvas min-w-0 flex-1 overflow-hidden">
        <AppHeader />
        <ScrollArea className="app-shell-scroll min-h-0 flex-1">
          <main
            id="main-content"
            tabIndex={-1}
            className="app-content mx-auto min-w-0 w-full max-w-[1920px] p-3 pb-8 outline-none sm:p-4 sm:pb-10 lg:p-6 2xl:p-8"
          >
            <Suspense fallback={<PageLoading />}>
              <ProtectedRouter />
            </Suspense>
          </main>
        </ScrollArea>
      </SidebarInset>
      <BreakAlertOverlay />
      <NotificationOverlay />
    </SidebarProvider>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/gestao-openai">
        <ProtectedRoute>
          <Suspense fallback={<PageLoading />}>
            <GestaoOpenAI />
          </Suspense>
        </ProtectedRoute>
      </Route>
      <Route path="/gestao">
        <ProtectedRoute>
          <Suspense fallback={<PageLoading />}>
            <Gestao />
          </Suspense>
        </ProtectedRoute>
      </Route>
      <Route>
        <ProtectedRoute>
          <AuthenticatedLayout />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function GlobalToaster() {
  const [location] = useLocation();
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";

  return (
    <Toaster placement={pathname === "/gestao" ? "management" : "default"} />
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="bi-helpdesk-theme">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <FilterProvider>
            <TooltipProvider>
              <AppRoutes />
              <GlobalToaster />
            </TooltipProvider>
          </FilterProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
