import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/phone";

export interface ContactSearchResult {
  id: string;
  name: string | null;
  profile_name: string | null;
  phone: string | null;
  wa_id: string;
  subLabel?: string | null;
}


interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  brandId?: string | null;
  className?: string;
  /** Busca customizada. Se ausente, usa a busca padrão direto em `contacts`. */
  searchFn?: (search: string) => Promise<ContactSearchResult[]>;
  /** Resolve o contato selecionado por id (útil quando a tabela `contacts` não é diretamente acessível). */
  fetchSelectedFn?: (id: string) => Promise<ContactSearchResult | null>;
  /** Texto exibido quando nenhum contato está selecionado. */
  placeholder?: string;
  /** Caracteres mínimos para disparar busca. Padrão: 2. */
  minChars?: number;
}

export function ContactFilterCombobox({ value, onChange, brandId, className, searchFn, fetchSelectedFn, placeholder, minChars }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const minLen = Math.max(1, minChars ?? 2);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input), 250);
    return () => clearTimeout(t);
  }, [input]);

  const selectedQ = useQuery({
    queryKey: ["contact-filter-selected", value, !!fetchSelectedFn],
    enabled: !!value,
    queryFn: async () => {
      if (fetchSelectedFn) return await fetchSelectedFn(value!);
      const { data } = await supabase.from("contacts").select("id, name, profile_name, phone, wa_id").eq("id", value!).maybeSingle();
      return (data ?? null) as ContactSearchResult | null;
    },
  });

  const searchQ = useQuery({
    queryKey: ["contact-filter-search", debounced, brandId, !!searchFn, minLen],
    enabled: open && debounced.trim().length >= minLen,
    queryFn: async () => {
      const s = debounced.trim();
      if (searchFn) return await searchFn(s);
      let q = supabase
        .from("contacts")
        .select("id, name, profile_name, phone, wa_id")
        .or(`name.ilike.%${s}%,profile_name.ilike.%${s}%,phone.ilike.%${s}%,wa_id.ilike.%${s}%`)
        .order("name", { ascending: true })
        .limit(20);
      if (brandId) q = q.eq("brand_id", brandId);
      const { data } = await q;
      return (data ?? []) as ContactSearchResult[];
    },
  });

  const selected = selectedQ.data;
  const label = selected ? (selected.name ?? selected.profile_name ?? formatPhoneDisplay(selected.phone ?? selected.wa_id) ?? "Contato") : (placeholder ?? "Filtrar por contato…");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          aria-expanded={open}
          tabIndex={0}
          className={cn(
            "flex h-9 w-[320px] cursor-text items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:border-ring focus-within:ring-1 focus-within:ring-ring",
            className,
          )}
        >
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>{label}</span>
          {value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Limpar filtro de contato"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Nome, telefone ou wa_id…" value={input} onValueChange={setInput} />
          <CommandList>
            {debounced.trim().length < minLen && (
              <div className="py-6 text-center text-xs text-muted-foreground">Digite ao menos {minLen} caracter{minLen > 1 ? "es" : ""}</div>
            )}
            {debounced.trim().length >= minLen && searchQ.isLoading && (
              <div className="py-6 text-center text-xs text-muted-foreground">Buscando…</div>
            )}
            {debounced.trim().length >= minLen && !searchQ.isLoading && (searchQ.data ?? []).length === 0 && (
              <CommandEmpty>Nenhum contato.</CommandEmpty>
            )}
            <CommandGroup>
              {(searchQ.data ?? []).map((c: any) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => { onChange(c.id); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex flex-col">
                    <span className="text-sm">{c.name ?? c.profile_name ?? "—"}</span>
                    <span className="text-xs text-muted-foreground font-mono">{formatPhoneDisplay(c.phone ?? c.wa_id)}</span>
                    {c.subLabel && <span className="text-[10px] text-muted-foreground">{c.subLabel}</span>}
                  </div>

                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
