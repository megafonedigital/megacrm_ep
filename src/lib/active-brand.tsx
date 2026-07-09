import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const STORAGE_KEY = "megacrm:active-brand";

export interface BrandOption {
  id: string;
  name: string;
  slug: string;
}

interface ActiveBrandValue {
  brands: BrandOption[];
  loading: boolean;
  activeBrandId: string | null;
  activeBrand: BrandOption | null;
  setActiveBrandId: (id: string) => void;
}

const ActiveBrandContext = createContext<ActiveBrandValue>({
  brands: [],
  loading: true,
  activeBrandId: null,
  activeBrand: null,
  setActiveBrandId: () => {},
});

export function ActiveBrandProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeBrandId, setActiveBrandIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  const brandsQ = useQuery({
    queryKey: ["active-brand-list", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<BrandOption[]> => {
      const { data, error } = await supabase.rpc("get_user_brands", { _user_id: user!.id });
      if (error) throw error;
      return (data ?? []) as BrandOption[];
    },
  });

  const brands = brandsQ.data ?? [];

  // Auto-select first brand if none selected or saved one is no longer accessible
  useEffect(() => {
    if (brandsQ.isLoading || brands.length === 0) return;
    const saved = activeBrandId;
    if (!saved || !brands.find((b) => b.id === saved)) {
      const next = brands[0].id;
      setActiveBrandIdState(next);
      if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
    }
  }, [brands, brandsQ.isLoading, activeBrandId]);

  const setActiveBrandId = (id: string) => {
    setActiveBrandIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  };

  const value = useMemo<ActiveBrandValue>(() => ({
    brands,
    loading: brandsQ.isLoading,
    activeBrandId,
    activeBrand: brands.find((b) => b.id === activeBrandId) ?? null,
    setActiveBrandId,
  }), [brands, brandsQ.isLoading, activeBrandId]);

  return <ActiveBrandContext.Provider value={value}>{children}</ActiveBrandContext.Provider>;
}

export function useActiveBrand() {
  return useContext(ActiveBrandContext);
}
