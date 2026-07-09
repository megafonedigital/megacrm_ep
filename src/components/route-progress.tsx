import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export function RouteProgress() {
  const isLoading = useRouterState({
    select: (s) => s.isLoading || s.isTransitioning,
  });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isLoading) {
      const t = setTimeout(() => setVisible(true), 120);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-transparent">
      <div className="route-progress-bar h-full bg-primary" />
    </div>
  );
}
