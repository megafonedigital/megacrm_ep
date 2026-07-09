import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "supervisor" | "agent" | "developer";
export type TeamType = "suporte" | "vendas";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ session: null, user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading }),
    [session, loading]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export interface ChannelRef {
  id: string;
  brand_id: string;
  name: string;
  type: TeamType;
}

export interface MeContext {
  userId: string | null;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
  channels: ChannelRef[];
  brandIds: string[];
  isAdmin: boolean;
  isSupervisor: boolean;
  isAgent: boolean;
  isDeveloper: boolean;
}

export function useMe() {
  const { user, loading } = useAuth();
  const query = useQuery<MeContext | null>({
    queryKey: ["me", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const [profileRes, rolesRes, channelsRes] = await Promise.all([
        supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase
          .from("channel_agents")
          .select("brand_channels:channel_id(id, brand_id, name, type)")
          .eq("user_id", user.id),
      ]);
      const roles = (rolesRes.data ?? []).map((r) => r.role) as AppRole[];
      const channels = ((channelsRes.data ?? [])
        .map((row: any) => row.brand_channels)
        .filter(Boolean) as ChannelRef[]);
      const brandIds = Array.from(new Set(channels.map((c) => c.brand_id)));
      return {
        userId: user.id,
        email: profileRes.data?.email ?? user.email ?? null,
        fullName: profileRes.data?.full_name ?? null,
        roles,
        channels,
        brandIds,
        isAdmin: roles.includes("admin"),
        isSupervisor: roles.includes("supervisor"),
        isAgent: roles.includes("agent"),
        isDeveloper: roles.includes("developer"),
      };
    },
  });
  return { me: query.data ?? null, loading: loading || query.isLoading };
}
