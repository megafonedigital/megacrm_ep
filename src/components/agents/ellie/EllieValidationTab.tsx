import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Plus, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  listHotmartProducts,
  upsertHotmartProduct,
  deleteHotmartProduct,
  testHotmartConnection,
  testEllieValidation,
} from "@/lib/ellie-hotmart.functions";

export function EllieValidationTab({
  agentId: _agentId,
  agent,
}: {
  agentId: string;
  agent: any;
  onSaved: () => void;
}) {
  const brandId: string = agent.brand_id;
  const qc = useQueryClient();
  const listFn = useServerFn(listHotmartProducts);
  const upsertFn = useServerFn(upsertHotmartProduct);
  const delFn = useServerFn(deleteHotmartProduct);
  const testFn = useServerFn(testHotmartConnection);
  const testValidationFn = useServerFn(testEllieValidation);

  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);

  const [valEmail, setValEmail] = useState("");
  const [valLoading, setValLoading] = useState(false);
  const [valResult, setValResult] = useState<null | {
    ok: boolean;
    status?: string;
    source?: string;
    matched?: string[];
    error?: string;
  }>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ellie-hotmart-products", brandId],
    queryFn: () => listFn({ data: { brandId } }),
    enabled: !!brandId,
  });
  const items: any[] = data?.items ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["ellie-hotmart-products", brandId] });

  const addProduct = async () => {
    if (!newId.trim()) return toast.error("Informe o ID do produto");
    try {
      await upsertFn({
        data: { brandId, product_id: newId.trim(), label: newLabel.trim() || null, active: true },
      });
      setNewId("");
      setNewLabel("");
      toast.success("Curso adicionado");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  };

  const toggleActive = async (it: any) => {
    await upsertFn({
      data: { id: it.id, brandId, product_id: it.product_id, label: it.label, active: !it.active },
    });
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este curso da lista?")) return;
    await delFn({ data: { id } });
    refresh();
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testFn({ data: { brandId } });
      setTestResult(
        r.ok
          ? { ok: true, msg: `Conexão OK (token ${r.tokenPrefix})` }
          : { ok: false, msg: r.error ?? "Falha" },
      );
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message ?? "Erro" });
    } finally {
      setTesting(false);
    }
  };

  const runValidation = async () => {
    if (!valEmail.trim()) return toast.error("Informe um e-mail");
    setValLoading(true);
    setValResult(null);
    try {
      const r: any = await testValidationFn({
        data: { brandId, email: valEmail.trim(), forceRefresh: true },
      });
      if (r.ok) {
        setValResult({
          ok: true,
          status: r.status,
          source: r.source,
          matched: r.matchedProductIds ?? [],
        });
      } else {
        setValResult({ ok: false, error: r.error });
      }
    } catch (e: any) {
      setValResult({ ok: false, error: e?.message ?? "Erro" });
    } finally {
      setValLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {/* 1) Credenciais */}
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Credenciais Hotmart</h3>
          <p className="text-xs text-muted-foreground">
            As chaves são armazenadas como secrets do projeto:{" "}
            <code>HOTMART_CLIENT_ID</code>, <code>HOTMART_CLIENT_SECRET</code> e{" "}
            <code>HOTMART_BASIC_TOKEN</code> (o "hottok" Basic). Use o botão abaixo para validar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={runTest} disabled={testing} size="sm" variant="outline">
            {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Testar conexão
          </Button>
          {testResult && (
            <span
              className={`text-xs flex items-center gap-1 ${
                testResult.ok ? "text-emerald-600" : "text-destructive"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {testResult.msg}
            </span>
          )}
        </div>
      </Card>

      {/* Teste de validação por e-mail */}
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Testar validação de aluno</h3>
          <p className="text-xs text-muted-foreground">
            Informe um e-mail e veja em tempo real se a Ellie classificaria como{" "}
            <strong>aluno</strong> (manual ou Hotmart) ou <strong>lead</strong>. Esta consulta
            ignora o cache de 24h.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs">E-mail do contato</Label>
            <Input
              type="email"
              value={valEmail}
              onChange={(e) => setValEmail(e.target.value)}
              placeholder="aluno@exemplo.com"
            />
          </div>
          <Button onClick={runValidation} disabled={valLoading}>
            {valLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Validar
          </Button>
        </div>
        {valResult && (
          <div className="text-xs border rounded-md p-3 bg-muted/30">
            {valResult.ok ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {valResult.status === "aluno" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-amber-600" />
                  )}
                  <span className="font-semibold uppercase">{valResult.status}</span>
                  <span className="text-muted-foreground">
                    (fonte: {valResult.source})
                  </span>
                </div>
                {valResult.matched && valResult.matched.length > 0 && (
                  <div>
                    Produtos correspondentes:{" "}
                    <code>{valResult.matched.join(", ")}</code>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-destructive flex items-center gap-1">
                <XCircle className="h-4 w-4" /> {valResult.error}
              </span>
            )}
          </div>
        )}
      </Card>


      {/* 2) Lista de cursos */}
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">IDs de cursos válidos</h3>
          <p className="text-xs text-muted-foreground">
            Se a Hotmart retornar qualquer um destes <code>product.id</code> para o e-mail do
            contato (em assinaturas ativas ou histórico de vendas), ele é classificado como aluno.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">ID do produto Hotmart</Label>
            <Input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="4375830"
              inputMode="numeric"
            />
          </div>
          <div>
            <Label className="text-xs">Nome interno (opcional)</Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ex.: Mentoria 2025"
            />
          </div>
          <Button onClick={addProduct}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        <div className="border rounded-md divide-y">
          {isLoading ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nenhum curso cadastrado. Adicione ao menos um para liberar a validação automática.
            </div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 p-3">
                <code className="font-mono text-sm w-28">{it.product_id}</code>
                <div className="flex-1 text-sm">
                  {it.label || <span className="text-muted-foreground italic">sem nome</span>}
                </div>
                <Switch checked={it.active} onCheckedChange={() => toggleActive(it)} />
                <Button size="icon" variant="ghost" onClick={() => remove(it.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* 3) Acessos manuais */}
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Acessos manuais</h3>
          <p className="text-xs text-muted-foreground">
            E-mails liberados sem compra na Hotmart (cortesias, equipe, etc.). A validação manual
            tem prioridade sobre a Hotmart.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/ellie/validations">
            <ExternalLink className="h-4 w-4 mr-1" /> Gerenciar acessos manuais
          </Link>
        </Button>
      </Card>
    </div>
  );
}
