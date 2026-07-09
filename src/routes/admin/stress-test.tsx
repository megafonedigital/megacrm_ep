import { createFileRoute } from "@tanstack/react-router";
import { guard, Placeholder } from "@/lib/placeholder";
export const Route = createFileRoute("/admin/stress-test")({
  beforeLoad: guard,
  component: () => <Placeholder title="Stress test" desc="Gerar carga inbound (webhooks fake) ou outbound (envios)." />,
});
