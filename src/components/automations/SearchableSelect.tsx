import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Optional custom render for the row (falls back to `label`). Must remain searchable via `label` text. */
  node?: ReactNode;
  /** Optional keywords to also match against during search. */
  keywords?: string[];
  disabled?: boolean;
};

export type SearchableSelectGroup = {
  heading?: string;
  options: SearchableSelectOption[];
};

type Props = {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Class applied to the trigger button (e.g. "h-8 text-xs"). */
  triggerClassName?: string;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Empty-state message. */
  emptyText?: string;
  /** Either pass a flat `options` array OR `groups` for headings. */
  options?: SearchableSelectOption[];
  groups?: SearchableSelectGroup[];
};

export function SearchableSelect({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  triggerClassName,
  searchPlaceholder = "Buscar…",
  emptyText = "Nenhuma opção encontrada.",
  options,
  groups,
}: Props) {
  const [open, setOpen] = useState(false);

  const normalizedGroups: SearchableSelectGroup[] = useMemo(() => {
    if (groups && groups.length > 0) return groups;
    return [{ options: options ?? [] }];
  }, [groups, options]);

  const flatOptions = useMemo(
    () => normalizedGroups.flatMap((g) => g.options),
    [normalizedGroups],
  );

  const selected = flatOptions.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            triggerClassName,
            className,
          )}
        >
          <span className="truncate text-left flex-1">
            {selected ? (selected.node ?? selected.label) : (placeholder ?? "Selecionar…")}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {normalizedGroups.map((group, gi) =>
              group.options.length > 0 ? (
                <CommandGroup key={group.heading ?? `g-${gi}`} heading={group.heading}>
                  {group.options.map((opt) => {
                    const isSelected = opt.value === value;
                    const keywords = [opt.label, ...(opt.keywords ?? [])];
                    return (
                      <CommandItem
                        key={opt.value}
                        value={opt.label}
                        keywords={keywords}
                        disabled={opt.disabled}
                        onSelect={() => {
                          onValueChange(opt.value);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 min-w-0 truncate">
                          {opt.node ?? opt.label}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
