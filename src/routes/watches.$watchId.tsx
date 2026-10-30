import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, Pause, Play, RotateCcw, Minus, Plus, ScanLine, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { WatchScene } from '@/components/WatchScene';
import { WatchAssembly } from '@/components/WatchAssembly';
import { WatchGallery } from '@/components/WatchGallery';
import { watches } from '@/lib/watches';
import { cart } from '@/lib/cart';
import { goBackOrTo } from '@/lib/back';
import { MidnightBackdrop } from '@/components/MidnightBackdrop';

const VirtualTryOn = lazy(() =>
  import('@/components/VirtualTryOn').then(module => ({ default: module.VirtualTryOn })),
);

export const Route = createFileRoute('/watches/$watchId')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { tryon?: boolean } => (search['tryon'] === true || search['tryon'] === 'true' ? { tryon: true } : {}),
  beforeLoad: ({ params }) => { if (!['steel','black','gold','rosegold'].includes(params.watchId)) throw notFound(); },
  head: ({ params }) => {
    const watch = watches.find(w => w.id === params.watchId);
    const title = `${watch?.name ?? 'Watch'} — The Collection`;
    const description = `Explore ${watch?.name ?? 'the collection'} in an animated 3D view with precision detailing and polished metal finishes.`;
    return { meta: [{ title }, { name: 'description', content: description }, { property: 'og:title', content: title }, { property: 'og:description', content: description }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] };
  },
  component: WatchPage,
});

function WatchPage() {
  const { watchId } = Route.useParams();
  const { tryon } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const watch = watches.find(w => w.id === watchId);
  const [moving, setMoving] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tryOnOpen, setTryOnOpen] = useState(!!tryon);
  useEffect(() => { if (tryon) setTryOnOpen(true); }, [tryon, watchId]);
  const closeTryOn = () => {
    setTryOnOpen(false);
    if (tryon) void navigate({ search: {}, replace: true });
  };
  if (!watch) return null;
  return <main className="watch-page" data-tone={watch.id}>
    <MidnightBackdrop variant="quiet" />
    <header className="watch-page-header">
      <Button asChild variant="ghost"><Link to="/" resetScroll={false} onClick={(e) => { if (goBackOrTo('/')) e.preventDefault(); }}><ArrowLeft />The collection</Link></Button>
      <span className="watch-page-wordmark">THE COLLECTION</span>
      <span className="watch-page-number">0{watches.findIndex(w => w.id === watch.id) + 1} / 04</span>
    </header>
    <div className="watch-page-title"><p>{watch.finish}</p><h1>{watch.name}</h1></div>
    {/* 3D views are unmounted while the camera try-on runs so the phone's GPU only renders one scene. */}
    {!tryOnOpen && <section className="watch-assembly-intro" aria-label={`${watch.name} assembly animation`}>
      <WatchAssembly key={watch.id} tone={watch.id} />
    </section>}
    {!tryOnOpen && <WatchScene tone={watch.id} moving={moving} interactive resetKey={resetKey} zoom={zoom} />}
    <div className="watch-viewer-toolbar" role="toolbar" aria-label="Watch visualization controls">
      <Button size="icon" variant="ghost" title={moving ? 'Pause animation' : 'Play animation'} aria-label={moving ? 'Pause animation' : 'Play animation'} aria-pressed={!moving} onClick={() => setMoving(v => !v)}>{moving ? <Pause /> : <Play />}</Button>
      <Button size="icon" variant="ghost" title="Zoom out" aria-label="Zoom out" disabled={zoom <= .8} onClick={() => setZoom(v => Math.max(.8, v - .1))}><Minus /></Button>
      <Button size="icon" variant="ghost" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 1.4} onClick={() => setZoom(v => Math.min(1.4, v + .1))}><Plus /></Button>
      <Button size="icon" variant="ghost" title="Reset view" aria-label="Reset view" onClick={() => { setResetKey(v => v + 1); setZoom(1); }}><RotateCcw /></Button>
      <span className="watch-toolbar-divider" aria-hidden="true" />
      <Button type="button" variant="ghost" className="watch-try-on-button" onClick={() => setTryOnOpen(true)}><ScanLine />Try on</Button>
      <Button type="button" variant="ghost" className="watch-try-on-button" onClick={() => { cart.add(watch.id); toast.success(`${watch.name} added to your cart`); }}><ShoppingBag />Add to cart</Button>
    </div>
    <nav className="watch-finish-nav" aria-label="Watch finishes">{watches.map(w => <Button key={w.id} asChild variant="ghost" className={w.id === watch.id ? 'selected' : ''}><Link to="/watches/$watchId" params={{ watchId: w.id }}><span className="watch-swatch" data-tone={w.id} />{w.finish}</Link></Button>)}</nav>
    <WatchGallery key={watch.id} watch={watch} />
    {tryOnOpen && <Suspense fallback={null}><VirtualTryOn watch={watch} open onClose={closeTryOn} /></Suspense>}
  </main>;
}
