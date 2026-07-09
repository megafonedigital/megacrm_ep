import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Loader2, Save, Trash2, MoreHorizontal, Search, Shield, ShieldCheck, Headphones, Code2, Users as UsersIcon, KeyRound,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { sendPasswordReset } from "@/lib/admin-users.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { callFunction } from "@/lib/api";
import { avatarColor, initials } from "@/lib/avatar-color";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const Route = createFileRoute("/admin/usuarios")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: UsuariosPage,
});

type Role = "admin" | "supervisor" | "agent" | "developer";

const ROLE_META: Record<Role, { label: string; icon: typeof Shield; tone: string }> = {
  admin: { label: "Admin", icon: Shield, tone: "bg-primary/10 text-primary border-primary/30" },
  supervisor: { label: "Supervisor", icon: ShieldCheck, tone: "bg-warning/10 text-warning border-warning/30" },
  agent: { label: "Agente", icon: Headphones, tone: "bg-success/10 text-success border-success/30" },
  developer: { label: "Desenvolvedor", icon: Code2, tone: "bg-ai/10 text-ai border-ai/30" },
};

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  active: boolean;
}
interface Channel { id: string; name: string; type: string; brand_id: string }
interface Brand { id: string; name: string; active: boolean }

function UsuariosPage() {
  const { me, loading } = useMe();
  const qc = useQueryClient();
  const sendResetFn = useServerFn(sendPasswordReset);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState<Profile | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");

  const profilesQ = useQuery<Profile[]>({
    queryKey: ["profiles-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,full_name,active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Profile[];
    },
  });

  const rolesQ = useQuery<Array<{ user_id: string; role: Role }>>({
    queryKey: ["all-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id,role");
      if (error) throw error;
      return data as any;
    },
  });

  const channelsQ = useQuery<Channel[]>({
    queryKey: ["all-channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_channels")
        .select("id,name,type,brand_id")
        .order("name");
      if (error) throw error;
      return data as Channel[];
    },
  });

  const brandsQ = useQuery<Brand[]>({
    queryKey: ["brands-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id,name,active").order("name");
      if (error) throw error;
      return data as Brand[];
    },
  });

  const channelAgentsQ = useQuery<Array<{ user_id: string; channel_id: string }>>({
    queryKey: ["channel-agents-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_agents").select("user_id,channel_id");
      if (error) throw error;
      return data as any;
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Profile) => {
      const { error } = await supabase.from("profiles").update({ active: !p.active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles-all"] });
      toast.success("Status atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteUser = useMutation({
    mutationFn: async (p: Profile) => {
      const { error } = await callFunction("delete-user", { user_id: p.id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles-all"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["channel-agents-all"] });
      toast.success("Usuário excluído.");
      setDeletingUser(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rolesByUser = useMemo(() => {
    const m: Record<string, Role[]> = {};
    for (const r of rolesQ.data ?? []) (m[r.user_id] ??= []).push(r.role);
    return m;
  }, [rolesQ.data]);

  const channelsByUser = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const r of channelAgentsQ.data ?? []) (m[r.user_id] ??= []).push(r.channel_id);
    return m;
  }, [channelAgentsQ.data]);

  const channelsById = useMemo(() => {
    const m: Record<string, Channel> = {};
    for (const c of channelsQ.data ?? []) m[c.id] = c;
    return m;
  }, [channelsQ.data]);

  const brandsById = useMemo(() => {
    const m: Record<string, Brand> = {};
    for (const b of brandsQ.data ?? []) m[b.id] = b;
    return m;
  }, [brandsQ.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (profilesQ.data ?? []).filter((p) => {
      if (term) {
        const hay = `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (roleFilter !== "all") {
        if (!(rolesByUser[p.id] ?? []).includes(roleFilter)) return false;
      }
      if (brandFilter !== "all") {
        const userChans = channelsByUser[p.id] ?? [];
        const hasBrand = userChans.some((cid) => channelsById[cid]?.brand_id === brandFilter);
        if (!hasBrand) return false;
      }
      return true;
    });
  }, [profilesQ.data, search, roleFilter, brandFilter, rolesByUser, channelsByUser, channelsById]);

  if (loading) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!me?.isAdmin) return <div className="p-8 text-destructive">Acesso restrito a administradores.</div>;

  const isEmpty = !profilesQ.isLoading && (profilesQ.data?.length ?? 0) <= 1;

  return (
    <div className="page-container">
      <div className="w-full">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie convites, papéis e quais canais cada pessoa atende.
            </p>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Convidar usuário
          </Button>
        </div>

        {isEmpty ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <UsersIcon className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold">Convide seu primeiro membro</h3>
              <p className="text-sm text-muted-foreground">
                Adicione agentes, supervisores ou outros administradores para colaborar.
              </p>
            </div>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Convidar agora
            </Button>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 p-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Papel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os papéis</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="agent">Agente</SelectItem>
                  <SelectItem value="developer">Desenvolvedor</SelectItem>
                </SelectContent>
              </Select>
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Workspace" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os workspaces</SelectItem>
                  {(brandsQ.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Usuário</TableHead>
                  <TableHead>Papéis</TableHead>
                  <TableHead>Canais</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum usuário com esses filtros.
                  </TableCell></TableRow>
                ) : filtered.map((p) => {
                  const userRoles = rolesByUser[p.id] ?? [];
                  const userChans = channelsByUser[p.id] ?? [];
                  return (
                    <TableRow key={p.id} className={p.active ? "" : "opacity-60"}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColor(p.id)}`}>
                            {initials(p.full_name ?? p.email)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{p.full_name ?? p.email ?? p.id.slice(0, 8)}</div>
                            {p.full_name && <div className="truncate text-xs text-muted-foreground">{p.email}</div>}
                            {p.id === me?.userId && <Badge variant="outline" className="mt-1 text-[10px]">você</Badge>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {userRoles.length === 0 ? (
                          <Badge variant="secondary" className="text-[10px]">sem papel</Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {userRoles.map((r) => {
                              const meta = ROLE_META[r];
                              const Icon = meta.icon;
                              return (
                                <Badge key={r} variant="outline" className={`gap-1 ${meta.tone}`}>
                                  <Icon className="h-3 w-3" /> {meta.label}
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                              {userChans.length} canal{userChans.length === 1 ? "" : "is"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72">
                            {userChans.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Sem canais atribuídos.</p>
                            ) : (
                              <div className="grid gap-2">
                                {Object.entries(
                                  userChans.reduce<Record<string, Channel[]>>((acc, cid) => {
                                    const c = channelsById[cid];
                                    if (c) (acc[c.brand_id] ??= []).push(c);
                                    return acc;
                                  }, {})
                                ).map(([bid, list]) => (
                                  <div key={bid}>
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      {brandsById[bid]?.name ?? "Workspace"}
                                    </div>
                                    <div className="mt-1 grid gap-0.5 pl-1">
                                      {list.map((c) => (
                                        <div key={c.id} className="flex items-center gap-2 text-xs">
                                          <span>{c.name}</span>
                                          <Badge variant="outline" className="text-[9px] capitalize">{c.type}</Badge>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch checked={p.active} onCheckedChange={() => toggleActive.mutate(p)} />
                          <span className="text-xs text-muted-foreground">{p.active ? "Ativo" : "Inativo"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditingUser(p)}>
                              Editar permissões
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                if (!p.email) return toast.error("Usuário sem e-mail cadastrado.");
                                try {
                                  await sendResetFn({
                                    data: { user_id: p.id, redirect_origin: window.location.origin },
                                  });
                                  toast.success(`E-mail de redefinição enviado para ${p.email}.`);
                                } catch (e: any) {
                                  toast.error(e?.message ?? "Falha ao enviar redefinição.");
                                }
                              }}
                            >
                              <KeyRound className="h-4 w-4" /> Enviar redefinição de senha
                            </DropdownMenuItem>
                            {me?.userId !== p.id && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setDeletingUser(p)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" /> Excluir
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        channels={channelsQ.data ?? []}
        brands={brandsQ.data ?? []}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["profiles-all"] });
          qc.invalidateQueries({ queryKey: ["all-roles"] });
          qc.invalidateQueries({ queryKey: ["channel-agents-all"] });
          setInviteOpen(false);
        }}
      />
      <EditPermsDialog
        user={editingUser}
        channels={channelsQ.data ?? []}
        brands={brandsQ.data ?? []}
        onClose={() => setEditingUser(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["all-roles"] });
          qc.invalidateQueries({ queryKey: ["channel-agents-all"] });
          setEditingUser(null);
        }}
      />
      <AlertDialog open={!!deletingUser} onOpenChange={(o) => !o && setDeletingUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingUser?.full_name ?? deletingUser?.email} perderá o acesso imediatamente.
              Mensagens enviadas anteriormente serão preservadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingUser && deleteUser.mutate(deletingUser)}
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RolePicker({ value, onChange }: { value: Role[]; onChange: (v: Role[]) => void }) {
  const all: Role[] = ["admin", "supervisor", "agent", "developer"];
  const selected = value[0] ?? "";
  return (
    <ToggleGroup
      type="single"
      value={selected}
      onValueChange={(v) => onChange(v ? [v as Role] : [])}
      className="justify-start"
    >
      {all.map((r) => {
        const meta = ROLE_META[r];
        const Icon = meta.icon;
        return (
          <ToggleGroupItem key={r} value={r} aria-label={meta.label} className="gap-1.5">
            <Icon className="h-3.5 w-3.5" /> {meta.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function ChannelMatrix({
  channels, brands, value, onChange,
}: { channels: Channel[]; brands: Brand[]; value: string[]; onChange: (v: string[]) => void }) {
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const byBrand: Record<string, Channel[]> = {};
    for (const c of channels) {
      if (term && !c.name.toLowerCase().includes(term)) continue;
      (byBrand[c.brand_id] ??= []).push(c);
    }
    return byBrand;
  }, [channels, search]);

  const toggle = (id: string, on: boolean) =>
    onChange(on ? Array.from(new Set([...value, id])) : value.filter((x) => x !== id));

  const toggleBrand = (brandChannels: Channel[], selectAll: boolean) => {
    const ids = brandChannels.map((c) => c.id);
    if (selectAll) onChange(Array.from(new Set([...value, ...ids])));
    else onChange(value.filter((x) => !ids.includes(x)));
  };

  if (brands.length === 0) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
      Nenhum workspace disponível.
    </div>;
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar canais…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>
      <div className="grid max-h-72 gap-3 overflow-auto p-3">
        {brands.map((b) => {
          const list = grouped[b.id] ?? [];
          const selected = list.filter((c) => value.includes(c.id)).length;
          const allSelected = list.length > 0 && selected === list.length;
          return (
            <div key={b.id} className="rounded-md border border-border bg-muted/30">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <div className="flex items-center gap-2">
                  {list.length > 0 ? (
                    <Checkbox
                      checked={allSelected ? true : selected > 0 ? "indeterminate" : false}
                      onCheckedChange={(c) => toggleBrand(list, !!c && c !== "indeterminate")}
                    />
                  ) : (
                    <div className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">{b.name}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {list.length > 0 ? `${selected}/${list.length}` : "sem canais"}
                </span>
              </div>
              {list.length > 0 ? (
                <div className="grid gap-1 p-2 sm:grid-cols-2">
                  {list.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-background">
                      <Checkbox
                        checked={value.includes(c.id)}
                        onCheckedChange={(on) => toggle(c.id, !!on)}
                      />
                      <span className="flex-1 truncate">{c.name}</span>
                      <Badge variant="outline" className="text-[9px] capitalize">{c.type}</Badge>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Sem canais ainda — conecte um número WhatsApp em Workspaces.
                </div>
              )}
            </div>
          );
        })}
        {Object.keys(grouped).length === 0 && (
          <div className="text-center text-xs text-muted-foreground">Nenhum canal corresponde a "{search}".</div>
        )}
      </div>
    </div>
  );
}

function InviteDialog({
  open, onClose, channels, brands, onSaved,
}: { open: boolean; onClose: () => void; channels: Channel[]; brands: Brand[]; onSaved: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState<Role[]>(["agent"]);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(""); setFullName(""); setRoles(["agent"]); setChannelIds([]);
    }
  }, [open]);

  const submit = async () => {
    if (!email) return toast.error("Informe o email.");
    setBusy(true);
    const { error } = await callFunction("invite-user", {
      email, full_name: fullName || null, roles, channel_ids: channelIds,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Convite enviado.");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
          <DialogDescription>Um email de convite será enviado para definir a senha.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@empresa.com" />
            </div>
            <div>
              <Label>Nome completo</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">Papéis</Label>
            <RolePicker value={roles} onChange={setRoles} />
          </div>
          <div>
            <Label className="mb-1.5 block">Canais que pode atender</Label>
            <ChannelMatrix channels={channels} brands={brands} value={channelIds} onChange={setChannelIds} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enviar convite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPermsDialog({
  user, channels, brands, onClose, onSaved,
}: { user: Profile | null; channels: Channel[]; brands: Brand[]; onClose: () => void; onSaved: () => void }) {
  const open = !!user;
  const [roles, setRoles] = useState<Role[]>([]);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [r, c] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("channel_agents").select("channel_id").eq("user_id", user.id),
      ]);
      setRoles(((r.data ?? []) as any).map((x: any) => x.role));
      setChannelIds(((c.data ?? []) as any).map((x: any) => x.channel_id));
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await supabase.from("user_roles").delete().eq("user_id", user.id);
      if (roles.length) {
        await supabase.from("user_roles").insert(roles.map((role) => ({ user_id: user.id, role })));
      }
      await supabase.from("channel_agents").delete().eq("user_id", user.id);
      if (channelIds.length) {
        await supabase.from("channel_agents").insert(channelIds.map((channel_id) => ({ user_id: user.id, channel_id })));
      }
      toast.success("Permissões atualizadas.");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {user && (
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${avatarColor(user.id)}`}>
                {initials(user.full_name ?? user.email)}
              </span>
            )}
            <span className="flex flex-col">
              <span>{user?.full_name ?? user?.email}</span>
              {user?.full_name && <span className="text-xs font-normal text-muted-foreground">{user.email}</span>}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label className="mb-1.5 block">Papéis</Label>
            <RolePicker value={roles} onChange={setRoles} />
          </div>
          <div>
            <Label className="mb-1.5 block">Canais que pode atender</Label>
            <ChannelMatrix channels={channels} brands={brands} value={channelIds} onChange={setChannelIds} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
