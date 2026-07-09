// Deterministic avatar colors + initials from a string.
// Paleta alinhada com os prints do MegaCRM: tons saturados, contraste branco.
const PALETTE = [
  "bg-[oklch(0.70_0.13_200)] text-white",  // teal
  "bg-[oklch(0.68_0.18_350)] text-white",  // pink
  "bg-[oklch(0.62_0.22_330)] text-white",  // magenta
  "bg-[oklch(0.62_0.22_295)] text-white",  // violet
  "bg-[oklch(0.66_0.20_25)] text-white",   // coral / red
  "bg-[oklch(0.63_0.16_150)] text-white",  // green
  "bg-[oklch(0.74_0.16_70)] text-white",   // amber
  "bg-[oklch(0.66_0.17_240)] text-white",  // indigo
  "bg-[oklch(0.68_0.16_220)] text-white",  // sky
  "bg-[oklch(0.55_0.22_265)] text-white",  // blue
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarColor(seed: string): string {
  return PALETTE[hash(seed || "x") % PALETTE.length];
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
