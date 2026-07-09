import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate, Link } from "@tanstack/react-router";
import { Loader2, Trash2, X, ExternalLink, ChevronsUpDown, Plus, Settings, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { deleteContacts } from "@/lib/contacts-admin.functions";
import { ensureContactConversation } from "@/lib/conversations.functions";
import { toE164, toE164Digits, formatPhoneDisplay, formatPhoneAsYouType } from "@/lib/phone";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";

import { ContactTimeline } from "@/components/contacts/ContactTimeline";
import { ContactAppointmentsList } from "@/components/agenda/ContactAppointmentsList";
import { EllieStatusBadge } from "@/components/ellie/EllieStatusBadge";
import { isEllie } from "@/lib/ellie";

type Mode = "view" | "create";

type CustomField = {
  id: string;
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "select";
  options: string[];
  position: number;
};

type TagRow = { id: string; name: string; color: string | null };

export function ContactDetailDialog({
  open, onOpenChange, contactId, brandId, onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId: string | null; // null = create mode
  brandId: string;
  onChanged?: () => void;
}) {
  const mode: Mode = contactId ? "view" : "create";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const deleteFn = useServerFn(deleteContacts);

  const [name, setName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [originalTags, setOriginalTags] = useState<string[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, any>>({});
  const [activeCustomKeys, setActiveCustomKeys] = useState<string[]>([]);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [customPickerQuery, setCustomPickerQuery] = useState("");
  const customPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!customPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!customPickerRef.current?.contains(e.target as Node)) setCustomPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCustomPickerOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [customPickerOpen]);

  const contactQ = useQuery({
    queryKey: ["contact-detail", contactId],
    enabled: open && !!contactId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, brand_id, name, profile_name, phone, wa_id, bsuid, username, metadata, created_at, updated_at")
        .eq("id", contactId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const activeChannelQ = useQuery({
    queryKey: ["contact-active-channel", contactId, brandId],
    enabled: open && !!contactId && !!brandId && mode === "view",
    queryFn: async () => {
      const { data } = await supabase
        .from("conversations")
        .select("id, last_message_at, channel:brand_channels!channel_id(id, name, phone_number)")
        .eq("contact_id", contactId!)
        .eq("brand_id", brandId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      return (data as any)?.channel ?? null;
    },
  });

  // Onda 1 BSUID: detecta possíveis duplicatas dentro do mesmo workspace
  // quando o contato tem múltiplos identificadores (phone + bsuid) e algum
  // outro contato compartilha um deles.
  const duplicatesQ = useQuery({
    queryKey: ["contact-duplicates", contactId, brandId],
    enabled: open && !!contactId && !!brandId && mode === "view" && !!contactQ.data,
    queryFn: async () => {
      const c = contactQ.data as any;
      if (!c) return [];
      const ors: string[] = [];
      if (c.phone) ors.push(`phone.eq.${c.phone}`);
      if (c.wa_id) ors.push(`wa_id.eq.${c.wa_id}`);
      if (c.bsuid) ors.push(`bsuid.eq.${c.bsuid}`);
      if (ors.length === 0) return [];
      const { data } = await supabase
        .from("contacts")
        .select("id, name, profile_name, phone, wa_id, bsuid")
        .eq("brand_id", brandId)
        .neq("id", c.id)
        .or(ors.join(","))
        .limit(5);
      return (data ?? []) as Array<{ id: string; name: string | null; profile_name: string | null; phone: string | null; wa_id: string | null; bsuid: string | null }>;
    },
  });

  const customFieldsQ = useQuery({

    queryKey: ["custom-fields", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("id, key, label, type, options, position")
        .eq("brand_id", brandId)
        .order("position");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        options: Array.isArray(r.options) ? r.options : [],
      })) as CustomField[];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setName(""); setProfileName(""); setPhone(""); setEmail(""); setTags([]); setOriginalTags([]); setCustomValues({}); setActiveCustomKeys([]);
      return;
    }
    const c = contactQ.data;
    if (!c) return;
    setName(c.name ?? "");
    setProfileName(c.profile_name ?? "");
    setPhone(c.phone ?? "");
    setEmail(((c.metadata as any)?.email as string) ?? "");
    const initial = Array.isArray((c.metadata as any)?.tags) ? (c.metadata as any).tags : [];
    setTags(initial);
    setOriginalTags(initial);
    const cv = (c.metadata as any)?.custom;
    const cvObj = cv && typeof cv === "object" ? cv : {};
    setCustomValues(cvObj);
    setActiveCustomKeys(Object.keys(cvObj));
  }, [open, mode, contactQ.data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const phoneE164 = phone.trim() ? toE164(phone) : null;
      const waId = phone.trim() ? toE164Digits(phone) : null;
      if (phone.trim() && (!phoneE164 || !waId)) throw new Error("Telefone inválido");
      const emailTrimmed = email.trim().toLowerCase();
      if (emailTrimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) throw new Error("E-mail inválido");
      const baseMeta = { ...(contactQ.data?.metadata as any ?? {}), tags, custom: customValues } as Record<string, any>;
      if (emailTrimmed) baseMeta.email = emailTrimmed; else delete baseMeta.email;
      const metadata = baseMeta;

      let cid: string;
      if (mode === "create") {
        if (!waId) throw new Error("Telefone é obrigatório");
        const { data, error } = await supabase
          .from("contacts")
          .insert({
            brand_id: brandId,
            wa_id: waId,
            phone: phoneE164,
            name: name.trim() || null,
            profile_name: profileName.trim() || null,
            metadata,
          })
          .select("id")
          .single();
        if (error) throw error;
        cid = data.id as string;
      } else {
        const { error } = await supabase
          .from("contacts")
          .update({
            name: name.trim() || null,
            profile_name: profileName.trim() || null,
            phone: phoneE164,
            wa_id: waId ?? contactQ.data?.wa_id,
            metadata,
          })
          .eq("id", contactId!);
        if (error) throw error;
        cid = contactId!;
      }

      // Dispatch tag automations (best-effort; never fail the save).
      const addedTags = tags.filter((t) => !originalTags.includes(t));
      const removedTags = originalTags.filter((t) => !tags.includes(t));
      let invokeFailed = 0;
      let noConvCount = 0;
      for (const tag of addedTags) {
        try {
          const { data, error } = await supabase.functions.invoke("automation-engine", {
            body: { event: "tag_added", contact_id: cid, tag },
          });
          if (error) { invokeFailed++; console.warn("tag_added invoke error", tag, error); continue; }
          if ((data as any)?.reason === "no_conversation") noConvCount++;
        } catch (e) {
          invokeFailed++; console.warn("tag_added invoke threw", tag, e);
        }
      }
      for (const tag of removedTags) {
        try {
          await supabase.functions.invoke("automation-engine", {
            body: { event: "tag_removed", contact_id: cid, tag },
          });
        } catch (e) {
          console.warn("tag_removed invoke threw", tag, e);
        }
      }
      return { cid, invokeFailed, noConvCount, addedCount: addedTags.length };
    },
    onSuccess: (res) => {
      toast.success(mode === "create" ? "Contato criado" : "Contato atualizado");
      if (res?.noConvCount && res.noConvCount > 0) {
        toast.info("Tag aplicada, mas o contato ainda não tem conversa — automações por tag rodam só após a primeira conversa.");
      }
      if (res?.invokeFailed && res.invokeFailed > 0) {
        toast.warning(`${res.invokeFailed} disparo(s) de automação falharam. Veja o console.`);
      }
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact-detail", contactId] });
      onChanged?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });

  const delMut = useMutation({
    mutationFn: async () => deleteFn({ data: { ids: [contactId!] } }),
    onSuccess: () => {
      toast.success("Contato excluído");
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onChanged?.();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao excluir"),
  });

  const addTag = (t: string) => {
    const v = t.trim();
    if (!v || tags.includes(v)) return;
    setTags([...tags, v]);
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));
  const setCustomValue = (key: string, value: any) =>
    setCustomValues((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{mode === "create" ? "Novo contato" : (contactQ.data?.name ?? contactQ.data?.profile_name ?? "Contato")}</span>
            {mode === "view" && contactId && isEllie(brandId) ? <EllieStatusBadge contactId={contactId} variant="full" /> : null}
          </DialogTitle>
        </DialogHeader>

        {mode === "view" && (duplicatesQ.data?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <strong>Possível duplicata:</strong> {duplicatesQ.data!.length} outro(s) contato(s) neste workspace compartilham telefone, WhatsApp ID ou BSUID.{" "}
            <span className="opacity-80">Revise antes de mesclar — nada é unificado automaticamente.</span>
          </div>
        )}

        {mode === "view" && contactQ.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              {mode === "view" && <TabsTrigger value="conversations">Conversas</TabsTrigger>}
              {mode === "view" && <TabsTrigger value="pipelines">Pipelines</TabsTrigger>}
              {mode === "view" && <TabsTrigger value="historico">Histórico</TabsTrigger>}
              {mode === "view" && <TabsTrigger value="events">Eventos</TabsTrigger>}
              {mode === "view" && <TabsTrigger value="agenda">Agenda</TabsTrigger>}
              {mode === "view" && <TabsTrigger value="automations">Automações</TabsTrigger>}
            </TabsList>

            <TabsContent value="overview" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome de perfil (WhatsApp)</Label>
                  <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Profile name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneAsYouType(e.target.value))}
                    placeholder="+55 11 99999-8888"
                    inputMode="tel"
                  />
                  <p className="text-xs text-muted-foreground">
                    Para números fora do Brasil, comece com <code>+</code> e o código do país (ex.: <code>+1 415 555 1234</code>).
                  </p>
                  {phone && <p className="text-xs text-muted-foreground">{formatPhoneDisplay(phone)}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail</Label>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="nome@dominio.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value.toLowerCase())}
                    onBlur={(e) => setEmail(e.target.value.trim().toLowerCase())}
                  />
                </div>
                {mode === "view" && (
                  <div className="space-y-1.5">
                    <Label>WhatsApp ID</Label>
                    <Input value={contactQ.data?.wa_id ?? ""} disabled className="font-mono text-xs" />
                  </div>
                )}
                {mode === "view" && (contactQ.data as any)?.bsuid && (
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-2">
                      BSUID
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Meta 2026</span>
                    </Label>
                    <Input value={(contactQ.data as any).bsuid} disabled className="font-mono text-xs" />
                  </div>
                )}
                {mode === "view" && (contactQ.data as any)?.username && (
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input value={(contactQ.data as any).username} disabled className="font-mono text-xs" />
                  </div>
                )}
                {mode === "view" && (
                  <div className="space-y-1.5">
                    <Label>Canal ativo</Label>
                    <Input
                      value={
                        activeChannelQ.data
                          ? `${activeChannelQ.data.name}${activeChannelQ.data.phone_number ? ` · ${activeChannelQ.data.phone_number}` : ""}`
                          : "—"
                      }
                      disabled
                      className="text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">Derivado da conversa mais recente neste workspace.</p>
                  </div>
                )}
              </div>


              <div className="space-y-1.5">
                <Label>Tags</Label>
                <TagPicker
                  brandId={brandId}
                  selected={tags}
                  onAdd={addTag}
                  onRemove={removeTag}
                />
              </div>

              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">Campos personalizados</Label>
                {customFieldsQ.data && customFieldsQ.data.length > 0 ? (
                  <div className="space-y-2">
                    {activeCustomKeys.length > 0 && (
                      <div className="grid grid-cols-2 gap-3">
                        {activeCustomKeys.map((key) => {
                          const f = customFieldsQ.data!.find((x) => x.key === key);
                          if (!f) return null;
                          return (
                            <div key={f.id} className="relative">
                              <CustomFieldInput
                                field={f}
                                value={customValues[f.key]}
                                onChange={(v: any) => setCustomValue(f.key, v)}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute top-0 right-0 h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setActiveCustomKeys((prev) => prev.filter((k) => k !== key));
                                  setCustomValues((prev) => {
                                    const next = { ...prev };
                                    delete next[key];
                                    return next;
                                  });
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {(() => {
                      const available = customFieldsQ.data!.filter((f) => !activeCustomKeys.includes(f.key));
                      if (available.length === 0) return null;
                      return (
                        <div ref={customPickerRef} className="relative inline-block">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setCustomPickerOpen((o) => !o)}
                          >
                            <Plus className="h-4 w-4 mr-2" /> Adicionar campo
                          </Button>
                          {customPickerOpen && (() => {
                            const q = customPickerQuery.trim().toLowerCase();
                            const filtered = q ? available.filter((f) => f.label.toLowerCase().includes(q)) : available;
                            return (
                              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border bg-popover text-popover-foreground shadow-md">
                                <div className="flex items-center border-b px-2">
                                  <Search className="h-4 w-4 opacity-50 shrink-0" />
                                  <input
                                    autoFocus
                                    value={customPickerQuery}
                                    onChange={(e) => setCustomPickerQuery(e.target.value)}
                                    placeholder="Buscar campo..."
                                    className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                                  />
                                </div>
                                <div className="max-h-72 overflow-auto p-1">
                                  {filtered.length === 0 ? (
                                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum campo encontrado.</div>
                                  ) : (
                                    filtered.map((f) => (
                                      <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => {
                                          setActiveCustomKeys((prev) => [...prev, f.key]);
                                          setCustomPickerOpen(false);
                                          setCustomPickerQuery("");
                                        }}
                                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                                      >
                                        {f.label}
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-md border border-dashed p-3">
                    <p className="text-xs text-muted-foreground">
                      Nenhum campo personalizado cadastrado neste workspace.
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/admin/configuracoes" onClick={() => onOpenChange(false)}>
                        <Settings className="h-3.5 w-3.5 mr-2" />
                        Gerenciar
                      </Link>
                    </Button>
                  </div>
                )}
              </div>

              {mode === "view" && contactQ.data && (
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>Criado em: {new Date(contactQ.data.created_at).toLocaleString("pt-BR")}</div>
                  <div>Atualizado em: {new Date(contactQ.data.updated_at).toLocaleString("pt-BR")}</div>
                </div>
              )}

              {mode === "view" && contactQ.data?.metadata && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="meta">
                    <AccordionTrigger className="text-xs">Metadata bruta</AccordionTrigger>
                    <AccordionContent>
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-60">{JSON.stringify(contactQ.data.metadata, null, 2)}</pre>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </TabsContent>

            {mode === "view" && contactId && (
              <>
                <TabsContent value="conversations" className="pt-4">
                  <ConversationsList contactId={contactId} brandId={brandId} onOpenInbox={(convId) => { onOpenChange(false); navigate({ to: "/inbox", search: convId ? { conv: convId } : {} }); }} />
                </TabsContent>
                <TabsContent value="pipelines" className="pt-4">
                  <PipelinesList contactId={contactId} brandId={brandId} />
                </TabsContent>
                <TabsContent value="historico" className="pt-4">
                  <ContactTimeline contactId={contactId} brandId={brandId} />
                </TabsContent>
                <TabsContent value="events" className="pt-4">
                  <EventsList contactId={contactId} />
                </TabsContent>
                <TabsContent value="agenda" className="pt-4">
                  <ContactAppointmentsList brandId={brandId} contactId={contactId} />
                </TabsContent>
                <TabsContent value="automations" className="pt-4">
                  <AutomationsList contactId={contactId} brandId={brandId} />
                </TabsContent>
              </>
            )}
          </Tabs>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {mode === "view" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={delMut.isPending}>
                    {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir contato?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Remove o contato e todas as conversas, mensagens, eventos e execuções relacionadas. Não pode ser desfeito.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => delMut.mutate()}>Excluir</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {mode === "create" ? "Criar" : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConversationsList({ contactId, brandId, onOpenInbox }: { contactId: string; brandId: string; onOpenInbox: (convId?: string) => void }) {
  const qc = useQueryClient();
  const ensureFn = useServerFn(ensureContactConversation);
  const [starting, setStarting] = useState(false);
  const [channelOpts, setChannelOpts] = useState<Array<{ id: string; name: string; phone_number: string | null }> | null>(null);
  const [pickedChannel, setPickedChannel] = useState<string>("");

  const q = useQuery({
    queryKey: ["contact-conversations", contactId, brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, status, last_message_at, unread_count, channel:brand_channels!channel_id(name, type)")
        .eq("contact_id", contactId)
        .eq("brand_id", brandId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function startConversation(channelId?: string) {
    setStarting(true);
    try {
      const result = await ensureFn({
        data: { brandId, contactId, ...(channelId ? { channelId } : {}) },
      });
      if ("needsChannel" in result && result.needsChannel) {
        setChannelOpts(result.channels);
        return;
      }
      setChannelOpts(null);
      setPickedChannel("");
      await qc.invalidateQueries({ queryKey: ["contact-conversations", contactId, brandId] });
      onOpenInbox(result.conversationId);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao iniciar conversa.");
    } finally {
      setStarting(false);
    }
  }

  if (q.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  const startBtn = (
    <Button size="sm" onClick={() => startConversation()} disabled={starting}>
      {starting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
      Iniciar conversa
    </Button>
  );

  const channelPicker = channelOpts && (
    <div className="flex items-end gap-2 rounded-md border p-3">
      <div className="flex-1">
        <Label className="text-xs">Selecione um canal</Label>
        <Select value={pickedChannel} onValueChange={setPickedChannel}>
          <SelectTrigger><SelectValue placeholder="Canal" /></SelectTrigger>
          <SelectContent>
            {channelOpts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}{c.phone_number ? ` · ${c.phone_number}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" disabled={!pickedChannel || starting} onClick={() => startConversation(pickedChannel)}>
        Continuar
      </Button>
      <Button size="sm" variant="ghost" onClick={() => { setChannelOpts(null); setPickedChannel(""); }}>
        Cancelar
      </Button>
    </div>
  );

  if (!q.data?.length) {
    return (
      <div className="space-y-3">
        {channelPicker}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Nenhuma conversa.</p>
          {!channelOpts && startBtn}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {channelPicker}
      {!channelOpts && <div className="flex justify-end">{startBtn}</div>}
      <div className="space-y-2">
        {q.data.map((c: any) => (
          <div key={c.id} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm">
            <div>
              <div className="font-medium">{c.channel?.name ?? "—"} <Badge variant="outline" className="ml-1 text-[10px]">{c.status}</Badge></div>
              <div className="text-xs text-muted-foreground">
                {c.last_message_at ? new Date(c.last_message_at).toLocaleString("pt-BR") : "Sem mensagens"}
                {c.unread_count > 0 && <span className="ml-2 text-primary">{c.unread_count} não lidas</span>}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onOpenInbox(c.id)}><ExternalLink className="h-3.5 w-3.5 mr-1" />Inbox</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelinesList({ contactId, brandId }: { contactId: string; brandId: string }) {
  const q = useQuery({
    queryKey: ["contact-pipelines", contactId, brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_contacts")
        .select("id, position, moved_at, pipeline:pipelines!pipeline_id(name), stage:pipeline_stages!stage_id(name, color)")
        .eq("contact_id", contactId)
        .eq("brand_id", brandId)
        .order("moved_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (q.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!q.data?.length) return <p className="text-sm text-muted-foreground">Não está em nenhum pipeline.</p>;
  return (
    <div className="space-y-2">
      {q.data.map((r: any) => (
        <div key={r.id} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm">
          <div>
            <div className="font-medium">{r.pipeline?.name}</div>
            <div className="text-xs text-muted-foreground">Etapa: {r.stage?.name}</div>
          </div>
          <div className="text-xs text-muted-foreground">{r.moved_at ? new Date(r.moved_at).toLocaleDateString("pt-BR") : ""}</div>
        </div>
      ))}
    </div>
  );
}

function EventsList({ contactId }: { contactId: string }) {
  const q = useQuery({
    queryKey: ["contact-events", contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_events")
        .select("id, event_type, created_at, payload, account:integration_accounts!account_id(name, platform)")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (q.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!q.data?.length) return <p className="text-sm text-muted-foreground">Sem eventos de integração.</p>;
  return (
    <div className="space-y-2">
      {q.data.map((e: any) => (
        <div key={e.id} className="border rounded-md px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">{e.event_type}</span>
            <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")}</span>
          </div>
          <div className="text-xs text-muted-foreground">{e.account?.platform} · {e.account?.name}</div>
        </div>
      ))}
    </div>
  );
}

function AutomationsList({ contactId, brandId }: { contactId: string; brandId: string }) {
  const q = useQuery({
    queryKey: ["contact-automations", contactId, brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("id, status, started_at, finished_at, automation:automations!automation_id(name)")
        .eq("contact_id", contactId)
        .eq("brand_id", brandId)
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (q.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!q.data?.length) return <p className="text-sm text-muted-foreground">Sem automações executadas.</p>;
  return (
    <div className="space-y-2">
      {q.data.map((r: any) => (
        <div key={r.id} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm">
          <div>
            <div className="font-medium">{r.automation?.name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString("pt-BR")}</div>
          </div>
          <Badge variant="outline">{r.status}</Badge>
        </div>
      ))}
    </div>
  );
}

function TagPicker({
  brandId, selected, onAdd, onRemove,
}: {
  brandId: string;
  selected: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const tagsQ = useQuery({
    queryKey: ["tags-picker", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags")
        .select("id, name, color")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as TagRow[];
    },
  });

  const colorByName = useMemo(() => {
    const m: Record<string, string | null> = {};
    (tagsQ.data ?? []).forEach((t) => { m[t.name] = t.color; });
    return m;
  }, [tagsQ.data]);

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("tags")
        .insert({ brand_id: brandId, name, color: "#64748b" })
        .select("id, name, color")
        .single();
      if (error) throw error;
      return data as TagRow;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["tags-picker", brandId] });
      onAdd(row.name);
      setInput("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao criar tag"),
  });

  const trimmed = input.trim();
  const available = (tagsQ.data ?? []).filter((t) => !selected.includes(t.name));
  const exactMatch = (tagsQ.data ?? []).some(
    (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const filtered = trimmed
    ? available.filter((t) => t.name.toLowerCase().includes(trimmed.toLowerCase()))
    : available;

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          onClick={() => setOpen((o) => !o)}
        >
          Selecionar ou criar tag…
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
        {open && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
            <div className="flex items-center border-b px-2">
              <Search className="h-4 w-4 opacity-50 shrink-0" />
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Buscar tag…"
                className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-72 overflow-auto p-1">
              {filtered.length === 0 && !(trimmed && !exactMatch) && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhuma tag.</div>
              )}
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onAdd(t.name); setInput(""); setOpen(false); }}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full mr-2 inline-block shrink-0"
                    style={{ backgroundColor: t.color ?? "#94a3b8" }}
                  />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              {trimmed && !exactMatch && (
                <button
                  type="button"
                  disabled={createMut.isPending}
                  onClick={() => createMut.mutate(trimmed)}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="h-3.5 w-3.5 mr-2 shrink-0" />
                  Criar tag "{trimmed}"
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {selected.length === 0 ? (
          <span className="text-xs text-muted-foreground">Sem tags</span>
        ) : (
          selected.map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="gap-1"
              style={colorByName[t] ? { backgroundColor: `${colorByName[t]}20`, color: colorByName[t]! } : undefined}
            >
              <span
                className="h-2 w-2 rounded-full inline-block"
                style={{ backgroundColor: colorByName[t] ?? "#94a3b8" }}
              />
              {t}
              <button type="button" onClick={() => onRemove(t)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

function CustomFieldInput({
  field, value, onChange,
}: {
  field: CustomField;
  value: any;
  onChange: (v: any) => void;
}) {
  if (field.type === "boolean") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{field.label}</Label>
        <div className="flex items-center h-9">
          <Switch checked={!!value} onCheckedChange={onChange} />
        </div>
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{field.label}</Label>
        <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
          <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{field.label}</Label>
      <Input
        type={inputType}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (field.type === "number") {
            onChange(raw === "" ? null : Number(raw));
          } else {
            onChange(raw || null);
          }
        }}
        placeholder={field.label}
      />
    </div>
  );
}
