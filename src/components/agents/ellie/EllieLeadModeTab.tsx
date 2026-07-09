import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  updateEllieLeadConfig,
  listLeadOffers,
  upsertLeadOffer,
  deleteLeadOffer,
} from "@/lib/ellie-lead.functions";

const DEFAULT_OFFER_PROMPT = `Você está em MODO OFERTA RÍGIDO.
O contato é um LEAD que já esgotou as mensagens gratuitas e ainda não comprou.
REGRAS:
- Só responda sobre os produtos listados no [CATÁLOGO DE OFERTAS].
- Não responda dúvidas, não dê conselhos, não traduza, não ajude com nada fora dos produtos.
- A cada resposta, apresente um produto adequado e envie o link de checkout.
- Se o contato insistir em outro assunto, responda educadamente que para continuar é necessário virar aluno e ofereça novamente os produtos.
- Mantenha as mensagens curtas (no máximo 2 linhas) e sempre termine com o link.`;

const DEFAULT_LEAD_PROMPT = `Este contato ainda é um LEAD (não é aluno). Ele tem um número limitado de mensagens gratuitas para experimentar a Ellie.
Seja útil e demonstre valor, mas mantenha respostas concisas. Não prometa acesso aos materiais pagos.`;

export function EllieLeadModeTab({
  agentId,
  agent,
  onSaved,
}: {
  agentId: string;
  agent: any;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const updateConfigFn = useServerFn(updateEllieLeadConfig);
  const listFn = useServerFn(listLeadOffers);
  const upsertFn = useServerFn(upsertLeadOffer);
  const delFn = useServerFn(deleteLeadOffer);

  const [limit, setLimit] = useState<number>(agent.lead_free_message_limit ?? 10);
  const [leadPrompt, setLeadPrompt] = useState<string>(
    agent.lead_mode_prompt ?? DEFAULT_LEAD_PROMPT,
  );
  const [offerPrompt, setOfferPrompt] = useState<string>(
    agent.lead_offer_prompt ?? DEFAULT_OFFER_PROMPT,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLimit(agent.lead_free_message_limit ?? 10);
    setLeadPrompt(agent.lead_mode_prompt ?? DEFAULT_LEAD_PROMPT);
    setOfferPrompt(agent.lead_offer_prompt ?? DEFAULT_OFFER_PROMPT);
  }, [agent.id]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await updateConfigFn({
        data: {
          agentId,
          lead_free_message_limit: Number(limit) || 0,
          lead_mode_prompt: leadPrompt,
          lead_offer_prompt: offerPrompt,
        },
      });
      toast.success("Configuração salva");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["ellie-lead-offers", agentId],
    queryFn: () => listFn({ data: { agentId } }),
  });
  const offers: any[] = data?.items ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["ellie-lead-offers", agentId] });

  // form for new offer
  const [nTitle, setNTitle] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nUrl, setNUrl] = useState("");
  const [nImg, setNImg] = useState("");
  const [adding, setAdding] = useState(false);

  const addOffer = async () => {
    if (!nTitle.trim()) {
      toast.error("Título obrigatório");
      return;
    }
    setAdding(true);
    try {
      await upsertFn({
        data: {
          agentId,
          title: nTitle.trim(),
          description: nDesc.trim() || null,
          checkout_url: nUrl.trim() || null,
          image_url: nImg.trim() || null,
          sort_order: offers.length,
          active: true,
        },
      });
      setNTitle("");
      setNDesc("");
      setNUrl("");
      setNImg("");
      refresh();
      toast.success("Oferta adicionada");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao adicionar");
    } finally {
      setAdding(false);
    }
  };

  const toggleActive = async (o: any) => {
    try {
      await upsertFn({
        data: {
          id: o.id,
          agentId,
          title: o.title,
          description: o.description,
          checkout_url: o.checkout_url,
          image_url: o.image_url,
          sort_order: o.sort_order,
          active: !o.active,
        },
      });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  };

  const removeOffer = async (id: string) => {
    if (!confirm("Remover esta oferta?")) return;
    try {
      await delFn({ data: { id, agentId } });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-4">
        <div>
          <h3 className="font-medium">Modo Lead — cota e prompts</h3>
          <p className="text-sm text-muted-foreground">
            Enquanto o contato não for validado como aluno, ele usa o prompt de lead até atingir o
            limite. Depois disso, a Ellie entra em modo oferta rígido.
          </p>
        </div>

        <div className="grid gap-2 max-w-xs">
          <Label htmlFor="limit">Mensagens gratuitas do lead</Label>
          <Input
            id="limit"
            type="number"
            min={0}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Contagem é por contato. Depois desse limite, modo oferta é ativado e nunca reseta
            sozinho.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="leadp">Prompt enquanto há créditos (lead)</Label>
          <Textarea
            id="leadp"
            rows={5}
            value={leadPrompt}
            onChange={(e) => setLeadPrompt(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="offerp">Prompt do modo oferta (esgotado)</Label>
          <Textarea
            id="offerp"
            rows={8}
            value={offerPrompt}
            onChange={(e) => setOfferPrompt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            O catálogo de ofertas abaixo é injetado automaticamente neste prompt.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={saveConfig} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar configuração
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <h3 className="font-medium">Catálogo de ofertas</h3>
          <p className="text-sm text-muted-foreground">
            Produtos apresentados no modo oferta. Inativos não vão para o prompt.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Título</Label>
            <Input value={nTitle} onChange={(e) => setNTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Link de checkout</Label>
            <Input
              value={nUrl}
              onChange={(e) => setNUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>Descrição curta</Label>
            <Textarea rows={2} value={nDesc} onChange={(e) => setNDesc(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>Imagem (URL, opcional)</Label>
            <Input value={nImg} onChange={(e) => setNImg(e.target.value)} placeholder="https://..." />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={addOffer} disabled={adding} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Adicionar oferta
          </Button>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : offers.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma oferta cadastrada.</div>
          ) : (
            offers.map((o) => (
              <div
                key={o.id}
                className="flex items-start gap-3 border rounded-md p-3 bg-card"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{o.title}</div>
                  {o.description && (
                    <div className="text-sm text-muted-foreground line-clamp-2">
                      {o.description}
                    </div>
                  )}
                  {o.checkout_url && (
                    <a
                      href={o.checkout_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline break-all"
                    >
                      {o.checkout_url}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={!!o.active} onCheckedChange={() => toggleActive(o)} />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOffer(o.id)}
                    aria-label="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
