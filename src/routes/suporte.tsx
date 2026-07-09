import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/suporte")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" });
  },
});
