import { Buffer } from "node:buffer";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOrderNotifications, type OrderNotificationResult } from "@/lib/notifications.server";

type ProductInput = Omit<Database["public"]["Tables"]["products"]["Insert"], "image_url"> & {
  images: string[];
};
type ProductChanges = Database["public"]["Tables"]["products"]["Update"];
type OrderChanges = Database["public"]["Tables"]["orders"]["Update"];
const ORDER_PAGE_SIZE = 500;
const PRODUCT_IMAGE_BUCKET = "product-images";

function storePermissionError(code?: string) {
  if (code === "42501") {
    return new Error(
      "Supabase denied store access. Apply the latest store database migrations, then try again.",
    );
  }
  return new Error(
    `Could not verify store permissions${code ? ` (${code})` : ""}. Please try again.`,
  );
}

function decodeProductImage(dataUrl: string): Buffer {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match?.[1]) throw new Error("A product photo is invalid. Please select the photos again.");
  return Buffer.from(match[1], "base64");
}

async function removeUploadedProductImages(paths: string[], productId: string) {
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths);
  if (error) {
    console.error("[Store] Could not clean up product images after a failed product save", {
      productId,
      error,
    });
  }
}

async function uploadProductImages(productId: string, images: string[]) {
  const paths: string[] = [];
  const urls: string[] = [];
  try {
    for (const image of images) {
      const path = `${productId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabaseAdmin.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .upload(path, decodeProductImage(image), {
          contentType: "image/jpeg",
          cacheControl: "31536000",
        });
      if (error) throw error;
      paths.push(path);
      urls.push(supabaseAdmin.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl);
    }
  } catch (error) {
    console.error("[Store] Could not upload product photos", { productId, error });
    await removeUploadedProductImages(paths, productId);
    if (error instanceof Error && error.message.startsWith("A product photo is invalid")) {
      throw error;
    }
    if (error instanceof Error && /bucket not found/i.test(error.message)) {
      throw new Error(
        "The product-images bucket is missing. Apply the 20261026120602_product_image_gallery migration in Supabase, then try again.",
      );
    }
    throw new Error(
      "Could not upload product photos. Check the product-images storage bucket and try again.",
    );
  }
  return { paths, urls };
}

async function requireStoreAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) {
    console.error("[Store] Could not verify seller permissions", error);
    throw storePermissionError(error.code);
  }
  if (!data) throw new Error("You do not have permission to manage this store.");
}

export async function listStoreOrders(userId: string, userClient: SupabaseClient<Database>) {
  const { data: isAdmin, error: roleError } = await userClient.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (roleError) {
    console.error("[Store] Could not verify seller access before loading orders", roleError);
    throw storePermissionError(roleError.code);
  }
  if (!isAdmin) throw new Error("You do not have permission to view store orders.");

  const orders: Database["public"]["Tables"]["orders"]["Row"][] = [];

  for (let offset = 0; ; offset += ORDER_PAGE_SIZE) {
    const { data, error } = await userClient
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + ORDER_PAGE_SIZE - 1);
    if (error) {
      console.error("[Store] Could not load seller orders", { offset, error });
      throw new Error("Could not load store orders. Please refresh and try again.");
    }
    orders.push(...data);
    if (data.length < ORDER_PAGE_SIZE) return orders;
  }
}

export async function createStoreProduct(userId: string, product: ProductInput, stock: number) {
  await requireStoreAdmin(userId);
  const { images, ...productFields } = product;
  const uploadedImages = await uploadProductImages(product.id, images);
  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({
      ...productFields,
      image_url: uploadedImages.urls[0]!,
      images: uploadedImages.urls,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[Store] Could not create product", error);
    await removeUploadedProductImages(uploadedImages.paths, product.id);
    throw new Error(
      "Could not save this watch. Check the product-image database migration and try again.",
    );
  }

  const { error: stockError } = await supabaseAdmin
    .from("inventory")
    .upsert({ watch_id: data.id, stock, updated_at: new Date().toISOString() });
  if (stockError) {
    console.error("[Store] Could not initialize product stock", {
      productId: data.id,
      error: stockError,
    });
    const { error: cleanupError } = await supabaseAdmin.from("products").delete().eq("id", data.id);
    await removeUploadedProductImages(uploadedImages.paths, product.id);
    if (cleanupError) {
      console.error("[Store] Could not roll back incomplete product", cleanupError);
      throw new Error("The watch was created but stock setup failed. Please contact support.");
    }
    throw new Error(
      "The watch was not added because its stock could not be initialized. Please try again.",
    );
  }
  return { id: data.id };
}

export async function updateStoreProduct(userId: string, id: string, changes: ProductChanges) {
  await requireStoreAdmin(userId);
  const { data: existing, error: readError } = await supabaseAdmin
    .from("products")
    .select("price,list_price")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    console.error("[Store] Could not validate product price changes", {
      productId: id,
      error: readError,
    });
    throw new Error("Could not validate this product update. Please try again.");
  }
  if (!existing) throw new Error("This watch no longer exists.");
  if ((changes.list_price ?? existing.list_price) < (changes.price ?? existing.price)) {
    throw new Error("MRP must be at least the selling price.");
  }
  const { data, error } = await supabaseAdmin
    .from("products")
    .update(changes)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[Store] Could not update product", { productId: id, error });
    throw new Error("Could not update this watch. Please try again.");
  }
  if (!data) throw new Error("This watch no longer exists.");
}

export async function deleteStoreProduct(userId: string, id: string) {
  await requireStoreAdmin(userId);
  if (["steel", "black", "gold", "rosegold"].includes(id)) {
    throw new Error("Original watches cannot be deleted.");
  }

  const { data, error } = await supabaseAdmin
    .from("products")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[Store] Could not delete product", { productId: id, error });
    throw new Error("Could not delete this watch. Please try again.");
  }
  if (!data) throw new Error("This watch no longer exists.");

  const warnings: string[] = [];
  const { error: stockError } = await supabaseAdmin.from("inventory").delete().eq("watch_id", id);
  if (stockError) {
    console.error("[Store] Product was deleted but its stock could not be removed", {
      productId: id,
      error: stockError,
    });
    warnings.push("Its stock entry could not be removed.");
  }

  const storage = supabaseAdmin.storage.from(PRODUCT_IMAGE_BUCKET);
  const { data: files, error: listError } = await storage.list(id, { limit: 1000 });
  if (listError) {
    console.error("[Store] Product was deleted but its photos could not be listed for cleanup", {
      productId: id,
      error: listError,
    });
    warnings.push("Its photos could not be cleaned up from storage.");
  } else if (files.length > 0) {
    const paths = files.map((file) => `${id}/${file.name}`);
    const { error: removeError } = await storage.remove(paths);
    if (removeError) {
      console.error("[Store] Product was deleted but its photos could not be removed", {
        productId: id,
        error: removeError,
      });
      warnings.push("Its photos could not be cleaned up from storage.");
    }
  }

  return { success: true, warnings };
}

export async function updateStoreStock(userId: string, id: string, stock: number) {
  await requireStoreAdmin(userId);
  const { error } = await supabaseAdmin
    .from("inventory")
    .upsert({ watch_id: id, stock, updated_at: new Date().toISOString() });
  if (error) {
    console.error("[Store] Could not update inventory", { productId: id, error });
    throw new Error("Could not update stock. Please try again.");
  }
}

export async function updateStoreOrder(userId: string, id: string, changes: OrderChanges) {
  await requireStoreAdmin(userId);
  const { data: existing, error: readError } = await supabaseAdmin
    .from("orders")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    console.error("[Store] Could not read order before updating it", {
      orderId: id,
      error: readError,
    });
    throw new Error("Could not update this order. Please try again.");
  }
  if (!existing) throw new Error("This order no longer exists.");

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update(changes)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[Store] Could not update order", { orderId: id, error });
    throw new Error("Could not update this order. Please try again.");
  }
  if (!data) throw new Error("This order no longer exists.");
  if (!changes.status || changes.status === existing.status) return { notifications: null };
  return { notifications: await notifyStoreOrderStatus(userId, id, changes.status) };
}

export async function notifyStoreOrderStatus(
  userId: string,
  id: string,
  expectedStatus: string,
): Promise<OrderNotificationResult> {
  await requireStoreAdmin(userId);
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id,user_id,items,total,address,status,payment,tracking_url")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[Store] Could not load order notification details", { orderId: id, error });
    throw new Error("Could not prepare order notifications. Please try again.");
  }
  if (!order) throw new Error("This order no longer exists.");
  if (order.status !== expectedStatus) {
    throw new Error("The order status changed. Refresh the page and try again.");
  }

  const { data: account, error: accountError } = await supabaseAdmin.auth.admin.getUserById(
    order.user_id,
  );
  if (accountError) {
    console.error("[Store] Could not read customer email for order notification", {
      orderId: id,
      error: accountError,
    });
  }
  const address =
    typeof order.address === "object" && order.address !== null && !Array.isArray(order.address)
      ? (order.address as Record<string, unknown>)
      : {};
  const items = Array.isArray(order.items)
    ? order.items.flatMap((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
        const line = item as Record<string, unknown>;
        return typeof line["id"] === "string" && typeof line["qty"] === "number"
          ? [{ id: line["id"], qty: line["qty"] }]
          : [];
      })
    : [];

  return sendOrderNotifications({
    orderId: order.id,
    email: account?.user?.email ?? null,
    name: typeof address["name"] === "string" ? address["name"] : "Customer",
    mobile: typeof address["mobile"] === "string" ? address["mobile"] : "",
    total: order.total,
    items,
    status: order.status,
    payment: order.payment,
    trackingUrl: order.tracking_url,
  });
}
