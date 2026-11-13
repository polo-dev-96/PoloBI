import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { SiOpenai } from "react-icons/si";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronDown,
  Command,
  LogOut,
  Search,
  ShieldCheck,
  TvMinimalPlay,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/context/FilterContext";
import { useToast } from "@/hooks/use-toast";
import { getNavigationItem } from "@/lib/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandMenu } from "@/components/command-menu";

function getInitials(name?: string, email?: string) {
  const value = name?.trim() || email?.split("@")[0] || "BI";
  const parts = value.split(/\s+/).filter(Boolean);

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

export function AppHeader() {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const { filters } = useFilters();
  const { toast } = useToast();
  const [commandOpen, setCommandOpen] = useState(false);
  const currentPage = useMemo(() => getNavigationItem(location), [location]);

  const openManagementView = () => {
    const params = new URLSearchParams();
    const allowedFilters = ["data_inicial", "data_final", "analista", "mesa_trabalho"] as const;

    allowedFilters.forEach((key) => {
      const value = filters[key]?.trim();
      if (value && value.length <= 120 && !/[\u0000-\u001F\u007F]/.test(value)) {
        params.set(key, value);
      }
    });

    const query = params.toString();
    const managementTab = window.open(
      `/gestao${query ? `?${query}` : ""}`,
      "polo-bi-management"
    );

    if (!managementTab) {
      toast({
        title: "Abertura da sala bloqueada",
        description: "Permita pop-ups para abrir a gestão em tempo real.",
        variant: "destructive",
      });
      return;
    }

    managementTab.focus();
  };

  return (
    <>
      <header className="app-topbar flex h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-5 lg:gap-3">
        <SidebarTrigger
          className="h-9 w-9 rounded-lg border border-border/70 bg-background/60"
          title="Abrir ou recolher menu (Ctrl+B)"
          data-testid="button-sidebar-toggle"
        />

        <div className="hidden h-6 w-px bg-border/80 sm:block" aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <div className="hidden items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:flex">
            <span>Polo Intelligence</span>
            <span className="text-border" aria-hidden="true">/</span>
            <span className="text-primary">{currentPage.shortTitle}</span>
          </div>
          <p className="truncate text-sm font-semibold text-foreground sm:hidden">
            {currentPage.title}
          </p>
          <p className="hidden truncate text-xs text-muted-foreground lg:block">
            {currentPage.description}
          </p>
        </div>

        <Button
          variant="outline"
          className="hidden h-9 w-full max-w-[280px] justify-start gap-2 rounded-lg bg-background/50 px-3 text-muted-foreground shadow-none lg:flex"
          onClick={() => setCommandOpen(true)}
          aria-label="Abrir busca rápida"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="flex-1 text-left text-xs">Navegação rápida</span>
          <kbd className="rounded border border-border/80 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Ctrl K
          </kbd>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 lg:hidden"
          onClick={() => setCommandOpen(true)}
          aria-label="Abrir busca rápida"
        >
          <Search aria-hidden="true" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 border-sky-500/25 bg-sky-500/[0.07] text-sky-600 shadow-none transition-colors hover:bg-sky-500/15 hover:text-sky-500 dark:text-sky-300"
          onClick={openManagementView}
          aria-label="Abrir sala de gestão em tempo real"
          title="Abrir sala de gestão em tempo real"
          data-testid="button-open-management"
        >
          <TvMinimalPlay className="h-4 w-4" aria-hidden="true" />
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-300"
              aria-label="Abrir Gestão da OpenAI em nova aba"
              data-testid="button-open-openai-management"
              onClick={() => {
                const tab = window.open("/gestao-openai", "polo-bi-openai-management");
                if (tab) tab.focus();
                else toast({ title: "Abertura bloqueada", description: "Permita pop-ups para abrir a Gestão da OpenAI.", variant: "destructive" });
              }}
            >
              <SiOpenai aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Gestão da OpenAI · abre em nova aba</TooltipContent>
        </Tooltip>

        <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-1.5 xl:flex">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            BI operacional
          </span>
        </div>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-10 gap-2 rounded-xl px-1.5 sm:pr-2.5"
              aria-label="Abrir menu da conta"
            >
              <Avatar className="h-8 w-8 ring-2 ring-primary/15">
                <AvatarFallback className="bg-gradient-to-br from-primary to-sky-500 text-[11px] font-bold text-white">
                  {getInitials(user?.name, user?.email)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden min-w-0 flex-col items-start sm:flex">
                <span className="max-w-[120px] truncate text-xs font-semibold leading-tight">
                  {user?.name || "Administrador"}
                </span>
                <span className="max-w-[120px] truncate text-[10px] leading-tight text-muted-foreground">
                  {user?.role || "Acesso seguro"}
                </span>
              </span>
              <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
            <DropdownMenuLabel className="p-2 font-normal">
              <span className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{user?.name || "Administrador"}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
                </span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-lg" onSelect={() => setCommandOpen(true)}>
              <Command aria-hidden="true" />
              Navegação rápida
              <span className="ml-auto text-[10px] text-muted-foreground">Ctrl K</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="rounded-lg" disabled>
              <ShieldCheck aria-hidden="true" />
              Sessão protegida
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="rounded-lg text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={logout}
            >
              <LogOut aria-hidden="true" />
              Encerrar sessão
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
