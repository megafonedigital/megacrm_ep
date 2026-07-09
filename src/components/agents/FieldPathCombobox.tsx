import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { discoverContactFieldPaths } from "@/lib/ai-agents.functions";
import { getFieldsForSource, type BindingSource } from "@/lib/template-bindings";

type Source =
  | "contact"
  | "brand"
  | "conversation"
  | "static"
  | "hotmart"
  | "shopify"
  | "activecampaign"
  | "sendflow";

const PLATFORM_SOURCES: Source[] = ["hotmart", "shopify", "activecampaign", "sendflow"];

const PLATFORM_HEADINGS: Record<string, string> = {
  hotmart: "Hotmart",
  shopify: "Shopify",
  activecampaign: "ActiveCampaign",
  sendflow: "SendFlow",
};

const CONTACT_COLUMNS: Array<{ path: string; label: string }> = [
  { path: "name", label: "Nome" },
  { path: "phone", label: "Telefone" },
  { path: "wa_id", label: "WhatsApp ID" },
  { path: "profile_name", label: "Profile name" },
];

const BRAND_FIELDS: Array<{ path: string; label: string }> = [
  { path: "name", label: "Nome" },
  { path: "slug", label: "Slug" },
  { path: "description", label: "Descrição" },
  { path: "active", label: "Ativo" },
];

const CONVERSATION_FIELDS: Array<{ path: string; label: string }> = [
  { path: "now", label: "Data/hora atual" },
  { path: "last_messages", label: "Últimas mensagens" },
];

export function FieldPathCombobox({
  source,
  brandId,
  value,
  onChange,
  disabled,
}: {
  source: Source;
  brandId: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const discoverFn = useServerFn(discoverContactFieldPaths);

  const { data: discovered } = useQuery({
    queryKey: ["contact-field-paths", brandId],
    queryFn: () => discoverFn({ data: { brandId } }),
    enabled: source === "contact" && !!brandId && open,
    staleTime: 60_000,
  });

  const groups = useMemo(() => {
    if (source === "brand") {
      return [{ heading: "Campos do workspace", items: BRAND_FIELDS.map((f) => ({ ...f, count: undefined as number | undefined })) }];
    }
    if (source === "conversation") {
      return [{ heading: "Conversa", items: CONVERSATION_FIELDS.map((f) => ({ ...f, count: undefined })) }];
    }
    if (source === "contact") {
      const dynamic = (discovered?.paths ?? []).map((p) => ({
        path: p.path,
        label: p.path,
        count: p.count,
      }));
      return [
        {
          heading: "Campos do contato",
          items: CONTACT_COLUMNS.map((f) => ({ ...f, count: undefined as number | undefined })),
        },
        {
          heading: "Campos personalizados (metadata)",
          items: dynamic,
        },
      ];
    }
    if (PLATFORM_SOURCES.includes(source)) {
      const fields = getFieldsForSource(source as BindingSource);
      return [
        {
          heading: PLATFORM_HEADINGS[source] ?? source,
          items: fields.map((f) => ({ path: f.key, label: f.label, count: undefined as number | undefined })),
        },
      ];
    }
    return [];
  }, [source, discovered]);

  if (source === "static" || disabled) {
    return (
      <Button variant="outline" disabled className="w-full justify-between font-normal text-muted-foreground">
        (não usado)
      </Button>
    );
  }

  const trimmed = search.trim();
  const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
  const showCustomOption = trimmed.length > 0 && !allPaths.includes(trimmed);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || "Selecionar campo…"}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Buscar ou digitar campo…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {source === "contact" && !discovered ? "Carregando…" : "Nenhum campo encontrado."}
            </CommandEmpty>

            {showCustomOption && (
              <CommandGroup heading="Personalizado">
                <CommandItem
                  value={`__custom__${trimmed}`}
                  onSelect={() => {
                    onChange(trimmed);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Usar <code className="ml-1 text-xs bg-muted px-1 rounded">{trimmed}</code>
                </CommandItem>
              </CommandGroup>
            )}

            {groups.map((group) =>
              group.items.length > 0 ? (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.path}
                      value={item.path}
                      onSelect={() => {
                        onChange(item.path);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === item.path ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <code className="text-xs">{item.path}</code>
                        {item.label !== item.path && (
                          <span className="ml-2 text-xs text-muted-foreground">{item.label}</span>
                        )}
                      </div>
                      {typeof item.count === "number" && (
                        <Badge variant="secondary" className="text-[10px] ml-2">
                          {item.count}
                        </Badge>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
