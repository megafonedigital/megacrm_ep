import { Image as ImageIcon, Video, FileText as FileIcon, ExternalLink, Reply } from "lucide-react";

export interface TemplateButton {
  type: "QUICK_REPLY" | "URL";
  text: string;
  url?: string;
}

export interface TemplatePreviewData {
  headerKind: "none" | "text" | "media";
  headerText?: string;
  headerTextExample?: string;
  headerMediaType?: "IMAGE" | "VIDEO" | "DOCUMENT";
  headerMediaPreviewUrl?: string | null;
  body: string;
  bodyExamples?: string[];
  footer?: string;
  buttons: TemplateButton[];
}

function renderWithExamples(text: string, examples?: string[]): string {
  if (!examples || examples.length === 0) return text;
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => {
    const idx = parseInt(n, 10) - 1;
    const v = examples[idx];
    return v && v.trim() ? v : m;
  });
}

export function TemplatePreview({
  data,
  hideEmptyMedia = false,
  hideButtons = false,
}: {
  data: TemplatePreviewData;
  hideEmptyMedia?: boolean;
  hideButtons?: boolean;
}) {
  const renderedHeader = renderWithExamples(data.headerText ?? "", data.headerTextExample ? [data.headerTextExample] : []);
  const renderedBody = renderWithExamples(data.body, data.bodyExamples);
  const showMediaSlot = data.headerKind === "media" && (data.headerMediaPreviewUrl || !hideEmptyMedia);
  return (
    <div className="rounded-xl bg-[#e5ddd5] p-4 dark:bg-muted/40">
      <div className="ml-auto max-w-[320px] rounded-lg bg-background shadow-sm">
        {showMediaSlot && (
          <div className="flex h-40 items-center justify-center overflow-hidden rounded-t-lg bg-muted text-muted-foreground">
            {data.headerMediaPreviewUrl ? (
              data.headerMediaType === "IMAGE" ? (
                <img src={data.headerMediaPreviewUrl} alt="" className="h-full w-full object-cover" />
              ) : data.headerMediaType === "VIDEO" ? (
                <video src={data.headerMediaPreviewUrl} className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2"><FileIcon className="h-8 w-8" /><span className="text-xs">Documento</span></div>
              )
            ) : (
              data.headerMediaType === "IMAGE" ? <ImageIcon className="h-8 w-8" />
              : data.headerMediaType === "VIDEO" ? <Video className="h-8 w-8" />
              : <FileIcon className="h-8 w-8" />
            )}
          </div>
        )}
        <div className="space-y-2 p-3">
          {data.headerKind === "text" && data.headerText && (
            <div className="text-sm font-semibold">{renderedHeader}</div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{renderedBody || <span className="text-muted-foreground">Corpo da mensagem…</span>}</div>
          {data.footer && <div className="text-xs text-muted-foreground">{data.footer}</div>}
        </div>
        {!hideButtons && data.buttons.length > 0 && (
          <div className="border-t border-border">
            {data.buttons.map((b, i) => (
              <button
                key={i}
                type="button"
                className="flex w-full items-center justify-center gap-1.5 border-b border-border py-2 text-sm font-medium text-primary last:border-b-0 hover:bg-accent/50"
              >
                {b.type === "URL" ? <ExternalLink className="h-3.5 w-3.5" /> : <Reply className="h-3.5 w-3.5" />}
                {b.text || <span className="text-muted-foreground">Texto do botão</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
