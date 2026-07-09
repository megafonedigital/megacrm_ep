import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type TagFilterValue = { tagId: string | null; noTag: boolean };

interface Props {
  value: TagFilterValue;
  onChange: (v: TagFilterValue) => void;
  brandId: string | null | undefined;
  className?: string;
}

interface TagRow { id: string; name: string; color: string | null }

export function TagFilterCombobox({ value, onChange, brandId, className }: Props) {
  const [open, setOpen] = useState(false);

  const tagsQ = useQuery({
    queryKey: ["tag-filter-tags", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags")
        .select("id, name, color")
        .eq("brand_id", brandId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as TagRow[];
    },
  });

  const selectedTag = useMemo(
    () => (value.tagId ? (tagsQ.data ?? []).find((t) => t.id === value.tagId) ?? null : null),
    [tagsQ.data, value.tagId],
  );

  const isActive = value.noTag || !!value.tagId;
  const label = value.noTag
    ? "Sem tag"
    : selectedTag
      ? selectedTag.name
      : "Tags";

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ tagId: null, noTag: false });
  };

  const pick = (next: TagFilterValue) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "secondary" : "ghost"}
          size="sm"
          className={cn("font-normal text-foreground", className)}
        >
          {isActive && selectedTag?.color && (
            <span
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: selectedTag.color }}
            />
          )}
          <span className="max-w-[160px] truncate">{label}</span>
          {isActive ? (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Limpar filtro de tag"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : (
            <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por..." />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>Nenhuma tag.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__no_tag__"
                onSelect={() => pick({ tagId: null, noTag: !value.noTag })}
              >
                <span className={cn(
                  "mr-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border",
                  value.noTag ? "border-primary bg-primary" : "border-input",
                )}>
                  {value.noTag && <span className="h-1.5 w-1.5 rounded-[1px] bg-primary-foreground" />}
                </span>
                <span className="text-muted-foreground">Sem tag</span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup>
              {(tagsQ.data ?? []).map((t) => {
                const active = value.tagId === t.id;
                return (
                  <CommandItem
                    key={t.id}
                    value={t.name}
                    onSelect={() => pick({ tagId: active ? null : t.id, noTag: false })}
                  >
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        background: (t.color ?? "#64748b") + "22",
                        color: t.color ?? "#475569",
                      }}
                    >
                      {t.name}
                    </span>
                    {active && (
                      <span className="ml-auto text-xs text-muted-foreground">Selecionada</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
