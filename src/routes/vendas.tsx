import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/vendas")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" });
  },
});
