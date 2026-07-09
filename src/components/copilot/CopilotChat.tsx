import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { saveCopilotAssistantMessage } from "@/lib/copilot-threads.functions";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X as XIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  threadId: string;
  brandId: string;
  initialMessages: UIMessage[];
  onTitleChange?: () => void;
}

const SUGGESTIONS = [
  "Quantas conversas a Bela respondeu nas últimas 24h?",
  "Quais automações estão travadas?",
  "Resumo de mensagens não entregues hoje",
  "Analise esta captura de tela do dashboard (anexe uma imagem)",
];

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/jpg,image/webp,image/gif";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 4;
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

async function uploadAttachment(
  file: FileUIPart,
  userId: string,
  threadId: string,
): Promise<FileUIPart> {
  // file.url is a blob: URL created by PromptInput from a real File
  const res = await fetch(file.url);
  const blob = await res.blob();
  const ext = extFromMime(file.mediaType ?? blob.type ?? "image/jpeg");
  const path = `${userId}/${threadId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("copilot-attachments")
    .upload(path, blob, {
      contentType: file.mediaType ?? blob.type,
      upsert: false,
    });
  if (upErr) throw upErr;
  const { data: signed, error: sErr } = await supabase.storage
    .from("copilot-attachments")
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (sErr || !signed?.signedUrl) throw sErr ?? new Error("Sem URL assinada");
  return {
    type: "file",
    filename: file.filename,
    mediaType: file.mediaType,
    url: signed.signedUrl,
  };
}

export function CopilotChat({ threadId, brandId, initialMessages, onTitleChange }: Props) {
  const qc = useQueryClient();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/public/copilot-chat",
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        prepareSendMessagesRequest: ({ messages, id, messageId }) => ({
          body: { threadId: id, brandId, messages, newMessageId: messageId },
        }),
      }),
    [brandId],
  );

  const saveAssistant = useServerFn(saveCopilotAssistantMessage);
  const abortSavedRef = useRef(false);

  const { messages, sendMessage, status, error, stop } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onFinish: ({ message, isAbort }) => {
      if (abortSavedRef.current) return;
      if (message?.role !== "assistant" || !message.id) return;
      const parts = (message.parts ?? []) as any[];
      if (parts.length === 0) return;
      abortSavedRef.current = true;

      const attemptSave = async (attempt: number): Promise<void> => {
        try {
          await saveAssistant({
            data: {
              threadId,
              sdkMessageId: message.id,
              parts,
              aborted: !!isAbort,
            },
          });
          void qc.invalidateQueries({ queryKey: ["copilot-messages", threadId] });
          void qc.invalidateQueries({ queryKey: ["copilot-threads", brandId] });
        } catch (e) {
          console.error(`[copilot] save assistant message (attempt ${attempt})`, e);
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
            return attemptSave(attempt + 1);
          }
          toast.error("Resposta exibida não foi salva", {
            description: "Recarregue a conversa para ver o estado persistido.",
          });
        }
      };
      void attemptSave(1);
    },
  });

  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, status]);

  useEffect(() => {
    if (status === "ready" && messages.length > 0 && onTitleChange) onTitleChange();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === "submitted" || status === "streaming") {
      abortSavedRef.current = false;
    }
  }, [status]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = (message.text ?? input).trim();
    const files = message.files ?? [];
    if (!text && files.length === 0) return;
    if (status === "submitted" || status === "streaming" || uploading) return;

    let uploadedFiles: FileUIPart[] = [];
    if (files.length > 0) {
      setUploading(true);
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const userId = userRes?.user?.id;
        if (!userId) throw new Error("Sessão expirada");
        uploadedFiles = await Promise.all(
          files.map((f) => uploadAttachment(f, userId, threadId)),
        );
      } catch (e) {
        console.error("[copilot] upload attachment", e);
        toast.error("Não foi possível enviar a imagem", {
          description: (e as Error)?.message,
        });
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    setInput("");
    await sendMessage({ text, files: uploadedFiles });
  };

  const sendSuggestion = async (text: string) => {
    if (status === "submitted" || status === "streaming") return;
    await sendMessage({ text });
  };

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Sparkles className="h-8 w-8 text-primary" />}
              title="Como posso ajudar?"
              description="Pergunte sobre dados do workspace, investigue problemas, anexe uma imagem ou peça para rascunhar mensagens."
            >
              <div className="mt-4 grid w-full max-w-md gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendSuggestion(s)}
                    className="rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-foreground/80 transition hover:border-primary/50 hover:bg-accent/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role === "user" ? "user" : "assistant"}>
                {m.role === "user" ? (
                  <MessageContent>
                    <div className="flex flex-col gap-2">
                      {m.parts.some((p) => p.type === "file") && (
                        <div className="flex flex-wrap gap-2">
                          {m.parts.map((p, i) =>
                            p.type === "file" && (p as any).mediaType?.startsWith("image/") ? (
                              <a
                                key={i}
                                href={(p as any).url}
                                target="_blank"
                                rel="noreferrer"
                                className="block overflow-hidden rounded-md border border-border/40"
                              >
                                <img
                                  src={(p as any).url}
                                  alt={(p as any).filename ?? "anexo"}
                                  className="max-h-48 max-w-[200px] object-cover"
                                />
                              </a>
                            ) : null,
                          )}
                        </div>
                      )}
                      {m.parts.map((p, i) =>
                        p.type === "text" ? <span key={i}>{p.text}</span> : null,
                      )}
                    </div>
                  </MessageContent>
                ) : (
                  <div className="flex w-full max-w-full flex-col gap-2">
                    {m.parts.map((p, i) => {
                      if (p.type === "text") {
                        return <MessageResponse key={i}>{p.text}</MessageResponse>;
                      }
                      if (p.type?.startsWith("tool-")) {
                        const tp = p as any;
                        const toolName = (p.type as string).replace(/^tool-/, "");
                        return (
                          <Tool key={i} defaultOpen={false}>
                            <ToolHeader type={toolName as any} state={tp.state ?? "output-available"} />
                            <ToolContent>
                              <ToolInput input={tp.input} />
                              <ToolOutput output={tp.output} errorText={tp.errorText} />
                            </ToolContent>
                          </Tool>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </Message>
            ))
          )}
          {(status === "submitted" || status === "streaming") && (
            <div className="px-2 py-1">
              <Shimmer>Pensando…</Shimmer>
            </div>
          )}
          {error && (
            <div className="mx-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border bg-card px-3 py-3">
        <PromptInput
          onSubmit={handleSubmit}
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          maxFiles={MAX_FILES}
          maxFileSize={MAX_FILE_SIZE}
          onError={(err) => {
            if (err.code === "max_file_size") {
              toast.error("Imagem muito grande (máx. 5 MB)");
            } else if (err.code === "max_files") {
              toast.error(`Máximo de ${MAX_FILES} imagens por mensagem`);
            } else if (err.code === "accept") {
              toast.error("Tipo de arquivo não suportado (use PNG, JPG, WEBP ou GIF)");
            }
          }}
        >
          <AttachmentsBar />
          <PromptInputTextarea
            ref={textareaRef as any}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte algo, cole ou anexe uma imagem…"
          />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments label="Anexar imagem" />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <SmartSubmit
              status={uploading ? "submitted" : status}
              onStop={stop}
              inputText={input}
              uploading={uploading}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

function SmartSubmit({
  status,
  onStop,
  inputText,
  uploading,
}: {
  status: "submitted" | "streaming" | "ready" | "error";
  onStop: () => void;
  inputText: string;
  uploading: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const hasContent = inputText.trim().length > 0 || attachments.files.length > 0;
  const disabled =
    uploading || (status !== "submitted" && status !== "streaming" && !hasContent);
  return <PromptInputSubmit status={status} onStop={onStop} disabled={disabled} />;
}

function AttachmentsBar() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border/40 px-3 py-2">
      {attachments.files.map((f) => (
        <div
          key={f.id}
          className="group relative overflow-hidden rounded-md border border-border bg-muted"
        >
          {f.mediaType?.startsWith("image/") ? (
            <img
              src={f.url}
              alt={f.filename ?? "anexo"}
              className="h-16 w-16 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center text-xs text-muted-foreground">
              {f.filename ?? "arquivo"}
            </div>
          )}
          <button
            type="button"
            onClick={() => attachments.remove(f.id)}
            className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-foreground/80 opacity-0 transition group-hover:opacity-100"
            aria-label="Remover anexo"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
