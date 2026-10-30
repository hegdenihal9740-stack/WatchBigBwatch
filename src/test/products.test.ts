import { describe, expect, it } from "vitest";
import { applyProducts, type ProductRow } from "@/lib/products";
import { watches } from "@/lib/watches";
import { prices } from "@/lib/cart";

describe("seller product catalog", () => {
  it("adds custom products with every uploaded image to the shared catalog", () => {
    const product: ProductRow = {
      id: "gallery-watch-test",
      name: "Gallery Watch Test",
      finish: "Brushed steel",
      price: 12000,
      list_price: 15000,
      description: "Test watch",
      details: ["Automatic movement"],
      image_url: "https://images.example.test/cover.jpg",
      images: ["https://images.example.test/cover.jpg", "https://images.example.test/side.jpg"],
      active: true,
      created_at: "2026-10-26T00:00:00.000Z",
    };

    applyProducts([product]);
    applyProducts([product]);

    const added = watches.find((watch) => watch.id === product.id) as
      ((typeof watches)[number] & { images?: string[] }) | undefined;
    expect(added?.image).toBe(product.image_url);
    expect(added?.images).toEqual(product.images);
    expect(watches.filter((watch) => watch.id === product.id)).toHaveLength(1);
  });

  it("applies persisted prices and visibility to original watches", () => {
    const originals: ProductRow[] = [
      {
        id: "steel",
        name: "Steel Diver",
        finish: "Brushed steel",
        price: 13000,
        list_price: 15000,
        description: "",
        details: [],
        image_url: "",
        images: [],
        active: true,
        created_at: "2026-10-26T00:00:00.000Z",
      },
      {
        id: "black",
        name: "Black Skeleton",
        finish: "Blackened metal",
        price: 14500,
        list_price: 16900,
        description: "",
        details: [],
        image_url: "",
        images: [],
        active: false,
        created_at: "2026-10-26T00:00:00.000Z",
      },
    ];

    applyProducts(originals);

    expect(prices["steel"]).toBe(13000);
    expect(watches.some((watch) => watch.id === "steel")).toBe(true);
    expect(watches.some((watch) => watch.id === "black")).toBe(false);

    applyProducts([]);
    expect(prices["steel"]).toBe(12800);
    expect(watches.some((watch) => watch.id === "black")).toBe(true);
  });
});
