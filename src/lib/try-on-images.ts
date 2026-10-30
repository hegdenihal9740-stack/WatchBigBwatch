import steel from "@/assets/try-on-steel.webp";
import black from "@/assets/try-on-black.webp";
import gold from "@/assets/try-on-gold.webp";
import rosegold from "@/assets/try-on-rosegold.webp";
import type { WatchTone } from "@/lib/watches";

// Dedicated face-centered crops preserve the collection's original photography.
export const tryOnImages: Record<WatchTone, string> = {
  steel,
  black,
  gold,
  rosegold,
};
