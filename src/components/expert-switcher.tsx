import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useActiveBrand } from "@/lib/active-brand";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function ExpertSwitcher() {
  const { brands, activeBrand, activeBrandId, setActiveBrandId, loading } = useActiveBrand();
  const { me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState(false);

  if (loading) {
    return (
      <Button variant="outline" size="sm" disabled className="h-8 gap-2">
        <Building2 className="h-4 w-4" />
        <span className="text-xs text-muted-foreground">Carregando...</span>
      </Button>
    );
  }

  if (brands.length === 0) {
    return (
      <Button variant="outline" size="sm" asChild className="h-8 gap-2">
        <Link to={me?.isAdmin ? "/admin/marcas" : "/"}>
          <Building2 className="h-4 w-4" />
          <span className="text-xs">Nenhum workspace</span>
        </Link>
      </Button>
    );
  }

  const handleSelect = (b: { id: string; name: string }) => {
    if (b.id === activeBrandId) return;
    setActiveBrandId(b.id);
    queryClient.invalidateQueries();
    toast.success(`Workspace alterado para ${b.name}`);
    setFlash(true);
    setTimeout(() => setFlash(false), 700);
    navigate({ to: "/inbox" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-2 transition-all",
            flash && "ring-2 ring-primary ring-offset-2 ring-offset-background"
          )}
        >
          <Building2 className="h-4 w-4" />
          <span className="max-w-[160px] truncate text-xs font-medium">
            {activeBrand?.name ?? "Selecione um workspace"}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Trocar de Workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {brands.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => handleSelect(b)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{b.name}</span>
            {b.id === activeBrandId && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        {me?.isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/admin/marcas" className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Gerenciar workspaces
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
