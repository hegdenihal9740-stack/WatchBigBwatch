import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  BUILT_IN,
  builtInWatchImage,
  ensureProducts,
  isBuiltIn,
  photoToDataUrl,
  slugify,
  type ProductRow,
} from "@/lib/products";
import { watchPrices, type WatchTone } from "@/lib/watches";
import { MAX_PRODUCT_IMAGES, productImageGallerySchema } from "@/lib/product-images";
import {
  createStoreProduct,
  deleteStoreProduct,
  updateStoreProduct,
  updateStoreStock,
} from "@/lib/store.functions";
const BUILT_NAMES: Record<string, string> = {
  steel: "Steel Diver",
  black: "Black Skeleton",
  gold: "Gold Chronograph",
  rosegold: "Rose Gold",
};

export function ProductManager() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");
  async function load() {
    const [{ data: p, error: productError }, { data: s, error: stockError }] = await Promise.all([
      supabase.from("products").select("*").order("created_at"),
      supabase.from("inventory").select("watch_id, stock"),
    ]);
    if (productError || stockError) {
      console.error("Could not load seller products and inventory.", productError ?? stockError);
      setMsg("Could not load watches or stock. Please refresh and try again.");
      return;
    }
    setRows(p ?? []);
    setStock(Object.fromEntries((s ?? []).map((r) => [r.watch_id, r.stock])));
    setMsg("");
  }
  useEffect(() => {
    void load().catch((error: unknown) => {
      console.error("Could not load seller products.", error);
      setMsg("Could not load watches or stock. Please try again.");
    });
  }, []);
  const refresh = async () => {
    await load();
    await ensureProducts(true);
  };

  async function saveStock(id: string, n: number) {
    const v = Math.max(0, Math.floor(n));
    try {
      await updateStoreStock({ data: { id, stock: v } });
      setMsg("Stock updated.");
      setStock((s) => ({ ...s, [id]: v }));
    } catch (error) {
      console.error("Could not update stock.", error);
      setMsg(error instanceof Error ? error.message : "Could not update stock.");
    }
  }

  async function removeProduct(id: string) {
    try {
      const result = await deleteStoreProduct({ data: { id } });
      await refresh();
      setMsg(
        result.warnings.length
          ? `Product deleted. ${result.warnings.join(" ")}`
          : "Product deleted.",
      );
    } catch (error) {
      console.error("Could not delete product.", error);
      setMsg(error instanceof Error ? error.message : "Could not delete this product.");
    }
  }

  const all = [
    ...BUILT_IN.map((id) => {
      const row = rows.find((product) => product.id === id) ?? null;
      return {
        id,
        name: BUILT_NAMES[id]!,
        price: row?.price ?? watchPrices[id as WatchTone],
        image: builtInWatchImage(id) as string,
        row,
        builtIn: true,
      };
    }),
    ...rows
      .filter((row) => !isBuiltIn(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        price: row.price,
        image: row.image_url,
        row,
        builtIn: false,
      })),
  ];

  return (
    <div className="space-y-4">
      <AddWatch onAdded={refresh} />
      {msg && (
        <p className="text-sm" role="status">
          {msg}
        </p>
      )}
      <h2 className="text-lg font-semibold">Your watches & stock</h2>
      {all.map((p) => (
        <ProductRowCard
          key={p.id}
          {...p}
          stock={stock[p.id] ?? 0}
          onStock={(n) => saveStock(p.id, n)}
          onChanged={refresh}
          onDelete={() => removeProduct(p.id)}
          builtIn={p.builtIn}
        />
      ))}
    </div>
  );
}

function ProductRowCard({
  id,
  name,
  price,
  image,
  row,
  stock,
  onStock,
  onChanged,
  onDelete,
  builtIn,
}: {
  id: string;
  name: string;
  price: number;
  image: string;
  row: ProductRow | null;
  stock: number;
  onStock: (n: number) => void;
  onChanged: () => void;
  onDelete: () => void;
  builtIn: boolean;
}) {
  const [n, setN] = useState(String(stock));
  const [p, setP] = useState(String(price));
  const [listPrice, setListPrice] = useState(String(row?.list_price ?? price));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setN(String(stock)), [stock]);
  useEffect(() => {
    setP(String(price));
    setListPrice(String(row?.list_price ?? price));
  }, [price, row?.list_price]);
  async function patch(v: Partial<ProductRow>) {
    setErr("");
    setBusy(true);
    try {
      await updateStoreProduct({ data: { id, changes: v } });
      await onChanged();
    } catch (error) {
      console.error("Could not update product.", error);
      setErr(error instanceof Error ? error.message : "Could not update product.");
    } finally {
      setBusy(false);
    }
  }
  async function savePrice() {
    const nextPrice = Number(p);
    const nextListPrice = Number(listPrice);
    if (!Number.isSafeInteger(nextPrice) || nextPrice < 1) {
      setErr("Selling price must be a positive whole number.");
      return;
    }
    if (!Number.isSafeInteger(nextListPrice) || nextListPrice < nextPrice) {
      setErr("MRP must be a whole number at least as high as the selling price.");
      return;
    }
    await patch({ price: nextPrice, list_price: nextListPrice });
  }
  return (
    <article className="acc-card flex flex-wrap items-center gap-3">
      {image && <img src={image} alt={name} className="h-14 w-14 rounded object-cover" />}
      <div className="min-w-32 flex-1">
        <b>{name}</b>
        <p className="text-xs text-muted-foreground">
          {stock <= 0 ? "Out of stock" : `${stock} in stock`}
          {row && !row.active ? " · Hidden" : ""}
          {!row ? " · Original" : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onStock(stock - 1)}
          aria-label="Less stock"
        >
          −
        </Button>
        <Input
          className="w-16"
          inputMode="numeric"
          value={n}
          onChange={(e) => setN(e.target.value)}
          onBlur={() => Number(n) !== stock && onStock(Number(n) || 0)}
          aria-label="Stock"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => onStock(stock + 1)}
          aria-label="More stock"
        >
          +
        </Button>
        <Button size="sm" variant="outline" onClick={() => onStock(0)}>
          Mark sold out
        </Button>
      </div>
      {row && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              Selling price (₹)
              <Input
                className="mt-1 w-28"
                inputMode="numeric"
                value={p}
                onChange={(e) => setP(e.target.value)}
                aria-label="Selling price"
              />
            </label>
            <label className="text-xs">
              MRP (₹)
              <Input
                className="mt-1 w-28"
                inputMode="numeric"
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                aria-label="MRP"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || (Number(p) === price && Number(listPrice) === row.list_price)}
              onClick={() => void savePrice()}
            >
              Save price
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => patch({ active: !row.active })}
            >
              {row.active ? "Hide" : "Show"}
            </Button>
            {!builtIn && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={busy}>
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes this watch from your catalog. Existing order history
                      is kept.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={onDelete}
                    >
                      Delete product
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </>
      )}
      {err && (
        <p role="alert" className="w-full text-sm text-destructive">
          {err}
        </p>
      )}
    </article>
  );
}

function AddWatch({ onAdded }: { onAdded: () => void }) {
  const empty = {
    name: "",
    finish: "",
    price: "",
    list: "",
    stock: "10",
    description: "",
    details: "",
  };
  const [f, setF] = useState(empty);
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const price = Number(f.price),
      stock = Number(f.stock);
    if (
      !f.name.trim() ||
      images.length === 0 ||
      !Number.isSafeInteger(price) ||
      price < 1 ||
      !Number.isSafeInteger(stock) ||
      stock < 0
    ) {
      setErr("Add a name, a photo, a whole-number price and valid stock.");
      return;
    }
    const listPrice = f.list ? Number(f.list) : price;
    if (!Number.isSafeInteger(listPrice) || listPrice < price) {
      setErr("MRP must be a whole number at least as high as the price.");
      return;
    }
    setBusy(true);
    const id = `${slugify(f.name) || "watch"}-${crypto.randomUUID().slice(0, 8)}`;
    const details = f.details
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await createStoreProduct({
        data: {
          product: {
            id,
            name: f.name.trim(),
            finish: f.finish.trim(),
            price,
            list_price: listPrice,
            description: f.description.trim(),
            details,
            images,
          },
          stock: Math.max(0, Math.floor(stock || 0)),
        },
      });
      setF(empty);
      setImages([]);
      await onAdded();
    } catch (error) {
      console.error("Could not add product.", error);
      setErr(error instanceof Error ? error.message : "Could not add the watch.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="acc-card space-y-2">
      <h2 className="text-lg font-semibold">Add new watch</h2>
      <label className="block text-sm">
        Photos (up to {MAX_PRODUCT_IMAGES})
        <input
          type="file"
          accept="image/*"
          multiple
          className="mt-1 block text-sm"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            setErr("");
            if (files.length > MAX_PRODUCT_IMAGES) {
              setImages([]);
              setErr(`Choose no more than ${MAX_PRODUCT_IMAGES} photos.`);
              e.target.value = "";
              return;
            }
            try {
              const preparedImages = await Promise.all(files.map((file) => photoToDataUrl(file)));
              const result = productImageGallerySchema.safeParse(preparedImages);
              if (!result.success) throw new Error(result.error.issues[0]?.message);
              setImages(result.data);
            } catch (error) {
              setImages([]);
              setErr(error instanceof Error ? error.message : "Could not prepare those photos.");
              e.target.value = "";
            }
          }}
        />
      </label>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Selected product photo previews">
          {images.map((image, index) => (
            <img
              key={`${index}-${image.length}`}
              src={image}
              alt={`Product photo ${index + 1}`}
              className="h-24 w-24 rounded object-cover"
            />
          ))}
        </div>
      )}
      <Input placeholder="Watch name (e.g. Titanium Diver)" value={f.name} onChange={set("name")} />
      <Input
        placeholder="Finish (e.g. Brushed titanium)"
        value={f.finish}
        onChange={set("finish")}
      />
      <div className="grid grid-cols-3 gap-2">
        <Input placeholder="Price ₹" inputMode="numeric" value={f.price} onChange={set("price")} />
        <Input placeholder="MRP ₹" inputMode="numeric" value={f.list} onChange={set("list")} />
        <Input placeholder="Stock" inputMode="numeric" value={f.stock} onChange={set("stock")} />
      </div>
      <textarea
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        rows={3}
        placeholder="Short description"
        value={f.description}
        onChange={set("description")}
      />
      <Input
        placeholder="Features, comma separated (e.g. 42mm case, Sapphire glass)"
        value={f.details}
        onChange={set("details")}
      />
      {err && (
        <p className="text-sm text-destructive" role="alert">
          {err}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add watch"}
      </Button>
    </form>
  );
}
