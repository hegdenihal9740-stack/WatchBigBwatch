import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { productImageGallerySchema } from "@/lib/product-images";
const productId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/);
const stock = z.number().int().min(0).max(100000);
const productFields = z.object({
  name: z.string().trim().min(1).max(100),
  finish: z.string().trim().max(100),
  price: z.number().int().positive().max(100000000),
  list_price: z.number().int().positive().max(100000000),
  description: z.string().trim().max(1000),
  details: z.array(z.string().trim().min(1).max(120)).max(12),
  image_url: z
    .string()
    .max(2_500_000)
    .url()
    .refine((value) => value.startsWith("https://"), "Use an HTTPS product image URL."),
  images: z.array(z.string().url().startsWith("https://")).max(5).optional(),
});
const newProductFields = productFields
  .omit({ image_url: true, images: true })
  .extend({ images: productImageGallerySchema });
const productChanges = productFields
  .partial()
  .extend({ active: z.boolean().optional() })
  .transform((changes) => ({
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.finish !== undefined ? { finish: changes.finish } : {}),
    ...(changes.price !== undefined ? { price: changes.price } : {}),
    ...(changes.list_price !== undefined ? { list_price: changes.list_price } : {}),
    ...(changes.description !== undefined ? { description: changes.description } : {}),
    ...(changes.details !== undefined ? { details: changes.details } : {}),
    ...(changes.image_url !== undefined ? { image_url: changes.image_url } : {}),
    ...(changes.images !== undefined ? { images: changes.images } : {}),
    ...(changes.active !== undefined ? { active: changes.active } : {}),
  }));
const orderStatus = z.enum(["confirmed", "packed", "shipped", "out_for_delivery", "delivered"]);
const courier = z.enum(["Delhivery", "Blue Dart", "DTDC", "India Post", "Shiprocket", "Other"]);
const orderTracking = z.object({
  status: orderStatus,
  courier: courier.nullable(),
  awb: z.string().trim().max(100).nullable(),
  tracking_url: z
    .string()
    .trim()
    .max(2048)
    .url()
    .nullable()
    .refine((value) => value === null || value.startsWith("https://")),
});

export const listStoreOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listStoreOrders: list } = await import("@/lib/store.server");
    return list(context.userId, context.supabase);
  });

export const createStoreProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      product: newProductFields
        .extend({ id: productId })
        .refine(
          (product) => product.list_price >= product.price,
          "MRP must be at least the selling price.",
        ),
      stock,
    }),
  )
  .handler(async ({ data, context }) => {
    const { createStoreProduct: create } = await import("@/lib/store.server");
    return create(context.userId, data.product, data.stock);
  });

export const updateStoreProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      id: productId,
      changes: productChanges.refine(
        (changes) => Object.keys(changes).length > 0,
        "Provide at least one product change.",
      ),
    }),
  )
  .handler(async ({ data, context }) => {
    const { updateStoreProduct: update } = await import("@/lib/store.server");
    await update(context.userId, data.id, data.changes);
    return { success: true };
  });

export const deleteStoreProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: productId }))
  .handler(async ({ data, context }) => {
    const { deleteStoreProduct: remove } = await import("@/lib/store.server");
    return remove(context.userId, data.id);
  });

export const updateStoreStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: productId, stock }))
  .handler(async ({ data, context }) => {
    const { updateStoreStock: update } = await import("@/lib/store.server");
    await update(context.userId, data.id, data.stock);
    return { success: true };
  });

export const updateStoreOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().min(1).max(100), changes: orderTracking }))
  .handler(async ({ data, context }) => {
    const { updateStoreOrder: update } = await import("@/lib/store.server");
    return update(context.userId, data.id, data.changes);
  });

export const notifyCancelledStoreOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data, context }) => {
    const { notifyStoreOrderStatus } = await import("@/lib/store.server");
    return notifyStoreOrderStatus(context.userId, data.id, "cancelled");
  });
