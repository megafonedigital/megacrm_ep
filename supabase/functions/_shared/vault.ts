import { getAdminClient } from "./supabase.ts";

export async function setChannelToken(channelId: string, token: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from("channel_secrets")
    .upsert({ channel_id: channelId, system_user_token: token, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Falha ao salvar token: ${error.message}`);
}

export async function getChannelToken(channelId: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("channel_secrets")
    .select("system_user_token")
    .eq("channel_id", channelId)
    .single();
  if (error || !data) throw new Error("Token do canal não encontrado.");
  return data.system_user_token as string;
}
