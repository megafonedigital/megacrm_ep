import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle as Facebook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { callFunction } from "@/lib/api";

interface Props {
  brandId: string;
  name: string;
  type: "suporte" | "vendas";
  onSuccess: (channelId: string) => void;
  disabled?: boolean;
}

interface MetaConfig {
  app_id: string;
  config_id: string;
  graph_version: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { FB?: any; fbAsyncInit?: () => void; }
}

let sdkLoadPromise: Promise<void> | null = null;

function loadFbSdk(appId: string, version: string): Promise<void> {
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    if (window.FB) {
      try {
        window.FB.init({ appId, cookie: false, xfbml: false, version });
      } catch (e) {
        console.error("[EmbeddedSignup] FB.init falhou", e);
      }
      resolve();
      return;
    }
    window.fbAsyncInit = function () {
      try {
        window.FB!.init({ appId, cookie: false, xfbml: false, version });
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    const id = "facebook-jssdk";
    if (document.getElementById(id)) return;
    const js = document.createElement("script");
    js.id = id;
    js.src = "https://connect.facebook.net/en_US/sdk.js";
    js.async = true;
    js.defer = true;
    js.onerror = () => reject(new Error("Falha ao baixar sdk.js do Facebook"));
    document.body.appendChild(js);
  });
  return sdkLoadPromise;
}

export function EmbeddedSignupButton({ brandId, name, type, onSuccess, disabled }: Props) {
  const [config, setConfig] = useState<MetaConfig | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessionDataRef = useRef<{ waba_id?: string; phone_number_id?: string }>({});
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  const clearTimeoutRef = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Carrega config pública do servidor (app_id + config_id) e SDK
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await callFunction<MetaConfig>("get-meta-public-config", {});
      if (cancelled) return;
      if (error || !data) {
        toast.error(error?.message ?? "Não foi possível carregar configuração Meta.");
        return;
      }
      setConfig(data);
      try {
        await loadFbSdk(data.app_id, data.graph_version);
        if (!cancelled) setSdkReady(true);
      } catch (e) {
        console.error("[EmbeddedSignup] erro ao carregar SDK", e);
        toast.error("Falha ao carregar SDK do Facebook. Verifique bloqueadores de script/anúncio.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listener para postMessage do popup do Embedded Signup
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      // origem deve ser facebook.com (https://www.facebook.com, etc.)
      try {
        const originHost = new URL(event.origin).hostname;
        if (!originHost.endsWith("facebook.com")) return;
      } catch {
        return;
      }
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "WA_EMBEDDED_SIGNUP") return;
        console.log("[EmbeddedSignup] evento Meta:", msg);
        if (msg.event === "FINISH" || msg.event === "FINISH_ONLY_WABA") {
          sessionDataRef.current = {
            waba_id: msg.data?.waba_id,
            phone_number_id: msg.data?.phone_number_id,
          };
        } else if (msg.event === "CANCEL") {
          cancelledRef.current = true;
          setLoading(false);
          clearTimeoutRef();
          const step = msg.data?.current_step ? ` (etapa: ${msg.data.current_step})` : "";
          toast.message(`Conexão cancelada${step}.`);
        } else if (msg.event === "ERROR") {
          cancelledRef.current = true;
          setLoading(false);
          clearTimeoutRef();
          toast.error(`Erro Meta: ${msg.data?.error_message ?? "falha no Embedded Signup"}`);
        }
      } catch {
        // ignora mensagens não-JSON
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleClick = async () => {
    if (!config || !sdkReady || !window.FB) {
      toast.error("SDK ainda carregando, tente novamente em instantes.");
      return;
    }
    if (!name.trim()) {
      toast.error("Informe o nome do canal antes de conectar.");
      return;
    }
    sessionDataRef.current = {};
    cancelledRef.current = false;
    setLoading(true);

    // Timeout de segurança: se o popup não retornar em 5min, libera o botão
    clearTimeoutRef();
    timeoutRef.current = window.setTimeout(() => {
      setLoading(false);
      toast.error(
        "Sem resposta da Meta. Verifique se o domínio atual está autorizado no app Meta e se você é Testador.",
      );
    }, 5 * 60 * 1000);

    // FB.login NÃO aceita callbacks async — precisa ser function comum.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onFbResponse = (response: any) => {
      clearTimeoutRef();
      setLoading(false);
      if (cancelledRef.current) return;
      if (!response) {
        toast.error("Sem resposta da Meta. Tente novamente.");
        return;
      }
      if (!response.authResponse?.code) {
        if (response.status !== "connected") {
          toast.message("Conexão cancelada ou popup fechado.");
        } else {
          toast.error("Login concluído mas nenhum 'code' foi retornado. Verifique config_id e permissões do app.");
        }
        return;
      }
      const code: string = response.authResponse.code;
      const { waba_id, phone_number_id } = sessionDataRef.current;
      if (!waba_id || !phone_number_id) {
        toast.error("Não recebemos o WABA/número da Meta. Tente novamente.");
        return;
      }
      setBusy(true);
      void (async () => {
        const { data, error } = await callFunction<{ channel_id: string }>(
          "whatsapp-finish-signup",
          { code, waba_id, phone_number_id, brand_id: brandId, name, type },
        );
        setBusy(false);
        if (error || !data) {
          toast.error(error?.message ?? "Falha ao concluir conexão.");
          return;
        }
        toast.success("WhatsApp conectado com sucesso!");
        onSuccess(data.channel_id);
      })();
    };

    try {
      window.FB.login(
        onFbResponse,
        {
          config_id: config.config_id,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            feature: "whatsapp_embedded_signup",
            sessionInfoVersion: 3,
          },
        },
      );
    } catch (e) {
      clearTimeoutRef();
      setLoading(false);
      console.error("[EmbeddedSignup] erro síncrono em FB.login", e);
      toast.error("Erro ao iniciar Embedded Signup: " + (e as Error).message);
    }
  };

  const buttonLabel = busy
    ? "Conectando..."
    : loading
      ? "Aguardando Meta..."
      : !config
        ? "Carregando configuração..."
        : !sdkReady
          ? "Carregando SDK..."
          : "Conectar via Embedded Signup";

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={disabled || !config || !sdkReady || loading || busy}
      className="bg-[#1877F2] hover:bg-[#1464d8] text-white"
    >
      {loading || busy || !config || !sdkReady ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Facebook className="h-4 w-4" />
      )}
      {buttonLabel}
    </Button>
  );
}
