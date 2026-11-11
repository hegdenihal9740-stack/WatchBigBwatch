import watchSteel from '@/assets/watch-steel.webp';
import watchBlack from '@/assets/watch-black.webp';
import watchGold from '@/assets/watch-gold.webp';
import watchRosegold from '@/assets/watch-rosegold.webp';
import watchSteelCard from '@/assets/watch-steel.jpg';
import watchBlackCard from '@/assets/watch-black.jpg';
import watchGoldCard from '@/assets/watch-gold.jpg';
import watchRosegoldCard from '@/assets/watch-rosegold.jpg';

export const watches = [
  { id: 'steel', name: 'Steel Diver', finish: 'Brushed steel', image: watchSteel, description: 'Cool brushed metal, a dark dial and a sculpted bracelet. A study in sharp contrasts.', details: ['Dark dial', 'Date window', 'Linked bracelet'] },
  { id: 'black', name: 'Black Skeleton', finish: 'Blackened metal', image: watchBlack, description: 'A dark silhouette with an exposed mechanical character. Warm accents bring the dial into focus.', details: ['Skeleton-style dial', 'Dark metal case', 'Mechanical detailing'] },
  { id: 'gold', name: 'Gold Chronograph', finish: 'Polished gold', image: watchGold, description: 'Polished golden surfaces meet a layered chronograph-style dial, with fine details at every angle.', details: ['Subdial detailing', 'Polished finish', 'Side pushers'] },
  { id: 'rosegold', name: 'Rose Gold', finish: 'Rose gold', image: watchRosegold, description: 'Warm rose-toned metal frames a light face. A dark textured strap brings a softer contrast to the polished case.', details: ['Rose-toned case', 'Light dial', 'Textured strap'] },
] as const;
export type WatchTone = typeof watches[number]['id'];
export const watchImages: Record<WatchTone, string> = {
  steel: watchSteel,
  black: watchBlack,
  gold: watchGold,
  rosegold: watchRosegold,
};
export const watchThumbnails: Record<WatchTone, string> = {
  steel: watchSteelCard,
  black: watchBlackCard,
  gold: watchGoldCard,
  rosegold: watchRosegoldCard,
};
export const watchPrices: Record<WatchTone, number> = { steel: 12800, black: 14500, gold: 18500, rosegold: 16900 };

export const watchCloseups: Record<WatchTone, readonly { title: string; description: string }[]> = {
  steel: [
    { title: 'Brushed steel silhouette', description: 'Cool metal links frame the dark face, balancing polished edges with a restrained steel finish.' },
    { title: 'Dark dial & date window', description: 'Light markers contrast with the dark dial, while the date window adds a distinct detail to the face.' },
    { title: 'Sculpted linked bracelet', description: 'Repeating metal links carry the steel finish around the wrist, with reflections changing across each surface.' },
  ],
  black: [
    { title: 'Blackened metal silhouette', description: 'A dark case and bracelet give this watch its monochrome character, punctuated by warm dial accents.' },
    { title: 'Skeleton-style face', description: 'Layered mechanical detailing brings depth to the open-style dial, revealing a more intricate visual character.' },
    { title: 'Dark metal links', description: 'The articulated bracelet continues the blackened finish, with subtle highlights tracing the edges of each link.' },
  ],
  gold: [
    { title: 'Polished golden silhouette', description: 'Golden surfaces wrap the case and bracelet, catching light along the bezel and sculpted links.' },
    { title: 'Layered chronograph-style dial', description: 'Subdial detailing creates a layered face, with contrasting markers and hands set against the golden case.' },
    { title: 'Polished links & case detailing', description: 'The bracelet repeats the polished golden finish; side pushers add a distinctive detail to the case profile.' },
  ],
  rosegold: [
    { title: 'Rose-toned case', description: 'Warm metal surrounds a light face, with the dark strap creating a crisp contrast to the polished case.' },
    { title: 'Light dial, warm frame', description: 'The pale face brings the hands and dial detailing into focus, framed by the rose-toned bezel.' },
    { title: 'Textured dark strap', description: 'A textured strap softens the metal silhouette, pairing a darker surface with the warm case finish.' },
  ],
};