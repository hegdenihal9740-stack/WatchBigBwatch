import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { ProductDetails } from "@/components/ProductDetails";
import { ShopHeader } from "@/components/ShopHeader";
import { ensureProducts } from "@/lib/products";
import { watches, type WatchTone } from "@/lib/watches";

export const Route = createFileRoute("/shop/$watchId")({
  ssr: false,
  beforeLoad: async ({ params }) => {
    await ensureProducts();
    if (!watches.some((w) => w.id === params.watchId)) throw notFound();
  },
  head: ({ params }) => {
    const w = watches.find((x) => x.id === params.watchId);
    const title = `Buy ${w?.name ?? "Watch"} — BIG-B`;
    const description = `Shop ${w?.name ?? "our watches"}: price, delivery, sizes, specifications and secure checkout.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "product" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: ShopPage,
});

function ShopPage() {
  const { watchId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <main className="shop-page">
      <ShopHeader />
      <ProductDetails
        key={watchId}
        tone={watchId as WatchTone}
        open
        asPage
        onOpenChange={() => {}}
        onSelectWatch={(id) => void navigate({ to: "/shop/$watchId", params: { watchId: id } })}
        onBuy={(id) => void navigate({ to: "/checkout", search: { item: id } })}
      />
    </main>
  );
}
