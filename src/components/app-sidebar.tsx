import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Building2, Users, FileText, Activity, FlaskConical, LogOut, Home, Workflow, KeyRound, ScrollText, Plug, KanbanSquare, Settings, Gauge, Bot, Library, LayoutDashboard, Crosshair, Send, Bell, BellOff, Volume2, VolumeX, ShieldOff, CalendarClock, Sparkles, GraduationCap } from "lucide-react";
import { isEllie } from "@/lib/ellie";
import { useNotifications } from "@/lib/notifications";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { avatarColor, initials as toInitials } from "@/lib/avatar-color";
import megacrmLogo from "@/assets/megacrm-logo.png";

type Item = { title: string; url: string; icon: any };

// TODO: restaurar itens ocultos temporariamente:
//   - { title: "Início", url: "/", icon: Home }
//   - { title: "Stress test", url: "/admin/stress-test", icon: FlaskConical }
const operationalItems: Item[] = [
  { title: "Inbox", url: "/inbox", icon: Inbox },
  { title: "Agenda", url: "/admin/agenda", icon: CalendarClock },
  { title: "Pipelines", url: "/pipelines", icon: KanbanSquare },
];

const expertAdminItems: Item[] = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
  { title: "Copilot", url: "/admin/copilot", icon: Sparkles },
  { title: "Rastreio", url: "/admin/rastreio", icon: Crosshair },
  { title: "Contatos", url: "/admin/contatos", icon: Users },
  { title: "Templates Meta", url: "/admin/templates", icon: FileText },
  { title: "Automações", url: "/admin/automacoes", icon: Workflow },
  { title: "Agentes de IA", url: "/admin/agentes", icon: Bot },
  { title: "Bases de Conhecimento", url: "/admin/bases-conhecimento", icon: Library },
  { title: "Execuções", url: "/admin/automacoes/runs", icon: Activity },
  { title: "Broadcasts", url: "/admin/broadcasts", icon: Send },
  { title: "Blocklist", url: "/admin/blocklist", icon: ShieldOff },
  { title: "Integrações", url: "/admin/integracoes", icon: Plug },
  { title: "Campos e Tags", url: "/admin/configuracoes", icon: Settings },
];


const globalAdminItems: Item[] = [
  { title: "Workspaces", url: "/admin/marcas", icon: Building2 },
  { title: "Usuários", url: "/admin/usuarios", icon: Users },
  { title: "API Keys", url: "/admin/api-keys", icon: KeyRound },
  { title: "Logs de API", url: "/admin/api-logs", icon: ScrollText },
  { title: "Filas & Limites", url: "/admin/filas", icon: Gauge },
];

// Itens visíveis também para supervisores dentro de "Administração do Workspace"
const expertAdminSupervisorUrls = new Set(["/admin/copilot", "/admin/contatos", "/admin/templates", "/admin/automacoes", "/admin/agentes", "/admin/bases-conhecimento", "/admin/rastreio", "/admin/automacoes/runs", "/admin/broadcasts", "/admin/blocklist", "/admin/configuracoes"]);

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { me } = useMe();
  const { activeBrand, activeBrandId } = useActiveBrand();
  const navigate = useNavigate();
  const { soundEnabled, browserEnabled, permission, setSoundEnabled, toggleBrowserEnabled } = useNotifications();

  const isActive = (path: string) => (path === "/" ? currentPath === "/" : currentPath.startsWith(path));

  // Contagem de conversas com não lidas (badge do item Inbox).
  // Usa head:true para não trafegar linhas; o índice parcial
  // idx_conversations_brand_unread torna isso O(log n).
  const unreadQuery = useQuery({
    queryKey: ["sidebar-unread", activeBrandId ?? "all"],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("conversations")
        .select("id", { head: true, count: "exact" })
        .eq("brand_id", activeBrandId!)
        .gt("unread_count", 0);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const unreadTotal = unreadQuery.data ?? 0;

  const dueAppointmentsQuery = useQuery({
    queryKey: ["appointments-due-count", activeBrandId, me?.userId],
    enabled: !!activeBrandId && !!me?.userId,
    queryFn: async () => {
      const horizon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("appointments")
        .select("id", { head: true, count: "exact" })
        .eq("brand_id", activeBrandId!)
        .eq("assignee_id", me!.userId!)
        .eq("status", "pending")
        .lte("scheduled_at", horizon);
      return count ?? 0;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const dueAppts = dueAppointmentsQuery.data ?? 0;

  const renderItem = (item: Item) => {
    const showUnread = item.url === "/inbox" && unreadTotal > 0;
    const showAppts = item.url === "/admin/agenda" && dueAppts > 0;
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
          <Link to={item.url as any} className="flex items-center gap-2">
            <item.icon className="h-4 w-4" />
            {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
          </Link>
        </SidebarMenuButton>
        {!collapsed && showUnread && (
          <SidebarMenuBadge className="bg-primary text-primary-foreground">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </SidebarMenuBadge>
        )}
        {!collapsed && showAppts && (
          <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
            {dueAppts > 99 ? "99+" : dueAppts}
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  };


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-center px-1 py-1">
          <img
            src={megacrmLogo}
            alt="MegaCRM"
            className={collapsed ? "w-full h-auto px-1 object-contain" : "h-10 w-auto max-w-full object-contain"}
          />
        </div>
        {!collapsed && activeBrand && (
          <div className="mx-2 mb-1 flex items-center gap-2 rounded-md border border-sidebar-border/60 bg-sidebar-accent/40 px-2 py-1.5">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${avatarColor(activeBrandId ?? activeBrand.name)}`}>
              {toInitials(activeBrand.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] uppercase tracking-wide text-sidebar-foreground/60">Workspace</div>
              <div className="truncate text-xs font-medium text-sidebar-foreground">{activeBrand.name}</div>
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Atendimento</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{operationalItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(me?.isAdmin || me?.isSupervisor || me?.isDeveloper) && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração do Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {expertAdminItems
                  .filter((i) => me?.isAdmin || me?.isDeveloper || expertAdminSupervisorUrls.has(i.url))
                  .map(renderItem)}
                {isEllie(activeBrandId) && renderItem({ title: "Validação alunos", url: "/admin/ellie/validations", icon: GraduationCap })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {(me?.isAdmin || me?.isDeveloper) && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração Global</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {globalAdminItems
                  .filter((i) => me?.isAdmin || i.url === "/admin/marcas" || i.url === "/admin/api-keys" || i.url === "/admin/api-logs" || i.url === "/admin/filas")
                  .map(renderItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-2 p-2">
          {!collapsed && me && (
            <div className="flex items-center gap-2 overflow-hidden px-1 py-1">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarColor(me.userId ?? me.email ?? "u")}`}>
                {toInitials(me.fullName ?? me.email ?? "?")}
              </span>
              <div className="min-w-0 text-xs">
                <div className="truncate font-medium">{me.fullName ?? me.email}</div>
                <div className="truncate text-muted-foreground">
                  {me.isAdmin ? "admin" : me.isDeveloper ? "desenvolvedor" : me.isSupervisor ? "supervisor" : me.isAgent ? "agente" : "sem papel"}
                </div>
              </div>
            </div>
          )}
          {!collapsed && (
            <div className="flex flex-col gap-1 rounded-md border border-sidebar-border/60 bg-sidebar-accent/30 p-2">
              <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
                Notificações
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="h-7 w-full justify-start gap-2 px-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                title={soundEnabled ? "Som ativado" : "Som desativado"}
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 opacity-60" />}
                <span className="flex-1 text-left">Som</span>
                <span className="text-[10px] text-sidebar-foreground/60">{soundEnabled ? "on" : "off"}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void toggleBrowserEnabled()}
                disabled={permission === "unsupported" || permission === "denied"}
                className="h-7 w-full justify-start gap-2 px-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                title={
                  permission === "denied"
                    ? "Permissão bloqueada no navegador"
                    : permission === "unsupported"
                    ? "Navegador sem suporte"
                    : browserEnabled
                    ? "Notificações do navegador ativadas"
                    : "Ativar notificações do navegador"
                }
              >
                {browserEnabled && permission === "granted" ? (
                  <Bell className="h-3.5 w-3.5" />
                ) : (
                  <BellOff className="h-3.5 w-3.5 opacity-60" />
                )}
                <span className="flex-1 text-left">Navegador</span>
                <span className="text-[10px] text-sidebar-foreground/60">
                  {permission === "denied"
                    ? "bloq."
                    : permission === "unsupported"
                    ? "n/d"
                    : browserEnabled
                    ? "on"
                    : "off"}
                </span>
              </Button>
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/login" });
            }}
            className="w-full justify-start gap-2 border border-sidebar-border/60 bg-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sair</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
