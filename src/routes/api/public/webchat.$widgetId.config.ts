import { createFileRoute } from "@tanstack/react-router";
import { webchatError, webchatJson, webchatPreflight } from "@/lib/webchat-cors.server";

type BusinessHours = {
  enabled?: boolean;
  timezone?: string;
  // days: { mon: { open: "09:00", close: "18:00" }, ... } — undefined day = closed
  days?: Record<string, { open: string; close: string } | null>;
};

function isWithinHours(bh: BusinessHours | null | undefined): boolean {
  if (!bh || !bh.enabled) return true;
  try {
    const tz = bh.timezone || "America/Sao_Paulo";
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase().slice(0, 3) ?? "";
    const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    const minutes = parseInt(hh, 10) * 60 + parseInt(mm, 10);
    const slot = bh.days?.[weekday];
    if (!slot) return false;
    const [oh, om] = slot.open.split(":").map((n) => parseInt(n, 10));
    const [ch, cm] = slot.close.split(":").map((n) => parseInt(n, 10));
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    return minutes >= openMin && minutes < closeMin;
  } catch {
    return true;
  }
}

export const Route = createFileRoute("/api/public/webchat/$widgetId/config")({
  server: {
    handlers: {
      OPTIONS: async () => webchatPreflight(),
      GET: async ({ params }) => {
        const widgetId = params.widgetId;
        if (!widgetId || !/^[0-9a-f-]{36}$/i.test(widgetId)) {
          return webchatError(400, "invalid_widget_id");
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: w, error } = await supabaseAdmin
          .from("webchat_widgets")
          .select(
            "id, logo_url, primary_color, widget_title, welcome_message, position, launcher_size, business_hours, offline_message, custom_css, active, display_mode, inline_max_width, inline_height, inline_fill_container, inline_align, require_phone, require_name, collect_email, header_subtitle_online, header_subtitle_offline, form_name_label, form_name_placeholder, form_phone_label, form_phone_placeholder, form_email_label, form_email_placeholder, form_submit_label, chat_input_placeholder, powered_by_label, allow_attachments",
          )
          .eq("id", widgetId)
          .maybeSingle();
        if (error || !w || !w.active) return webchatError(404, "widget_not_found");

        const online = isWithinHours(w.business_hours as BusinessHours | null);
        const anyW = w as Record<string, unknown>;

        return webchatJson(
          {
            id: w.id,
            logo_url: w.logo_url,
            primary_color: w.primary_color,
            widget_title: w.widget_title,
            welcome_message: w.welcome_message,
            position: w.position,
            launcher_size: w.launcher_size,
            offline_message: w.offline_message,
            custom_css: w.custom_css,
            display_mode: (anyW.display_mode as string | undefined) ?? "popup",
            inline_max_width: (anyW.inline_max_width as number | null | undefined) ?? null,
            inline_height: (anyW.inline_height as number | null | undefined) ?? 600,
            inline_fill_container: (anyW.inline_fill_container as boolean | undefined) ?? false,
            inline_align: (anyW.inline_align as string | undefined) ?? "center",
            require_phone: (anyW.require_phone as boolean | undefined) ?? true,
            require_name: (anyW.require_name as boolean | undefined) ?? true,
            collect_email: (anyW.collect_email as boolean | undefined) ?? false,
            header_subtitle_online: (anyW.header_subtitle_online as string | null | undefined) ?? null,
            header_subtitle_offline: (anyW.header_subtitle_offline as string | null | undefined) ?? null,
            form_name_label: (anyW.form_name_label as string | null | undefined) ?? null,
            form_name_placeholder: (anyW.form_name_placeholder as string | null | undefined) ?? null,
            form_phone_label: (anyW.form_phone_label as string | null | undefined) ?? null,
            form_phone_placeholder: (anyW.form_phone_placeholder as string | null | undefined) ?? null,
            form_email_label: (anyW.form_email_label as string | null | undefined) ?? null,
            form_email_placeholder: (anyW.form_email_placeholder as string | null | undefined) ?? null,
            form_submit_label: (anyW.form_submit_label as string | null | undefined) ?? null,
            chat_input_placeholder: (anyW.chat_input_placeholder as string | null | undefined) ?? null,
            powered_by_label: (anyW.powered_by_label as string | null | undefined) ?? null,
            allow_attachments: (anyW.allow_attachments as boolean | undefined) ?? true,
            online,
          },
          200,
          { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" },
        );


      },
    },
  },
});
