type OrderNotificationInput = {
  orderId: string;
  email: string | null;
  name: string;
  mobile: string;
  total: number;
  items: { id: string; qty: number }[];
  status: string;
  payment: string;
  trackingUrl?: string | null;
};

type NotificationContact = {
  name: string;
  email: string;
};

type NotificationAudience = "customer" | "owner";

export type OrderNotificationResult = {
  email: "sent" | "failed" | "not_configured";
};

class NotificationConfigurationError extends Error {}

const statusLabels: Record<string, string> = {
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function orderDetails(
  input: OrderNotificationInput,
  audience: NotificationAudience,
  contact: NotificationContact,
) {
  const status = statusLabels[input.status] ?? input.status;
  const products = input.items.map((item) => `${item.id} x ${item.qty}`).join(", ");
  const tracking = input.trackingUrl ? `\nTracking: ${input.trackingUrl}` : "";
  return {
    status,
    subject:
      audience === "owner"
        ? `New BIG-B order - ${input.orderId}`
        : input.status === "confirmed"
          ? `BIG-B order confirmed - ${input.orderId}`
          : `BIG-B order update - ${input.orderId}`,
    text:
      audience === "owner"
        ? [
            `Hello ${contact.name} team,`,
            "",
            `A new BIG-B order (${input.orderId}) was ${status.toLowerCase()}.`,
            `Customer: ${input.name}`,
            `Customer email: ${input.email ?? "Unavailable"}`,
            `Customer mobile: +91 ${input.mobile}`,
            `Items: ${products}`,
            `Total: INR ${input.total.toLocaleString("en-IN")}`,
            `Payment: ${paymentLabel(input.payment)}`,
          ].join("\n")
        : [
            `Hello ${input.name},`,
            "",
            `Your BIG-B order ${input.orderId} is ${status.toLowerCase()}.`,
            `Items: ${products}`,
            `Total: INR ${input.total.toLocaleString("en-IN")}`,
            `Payment: ${paymentLabel(input.payment)}`,
            tracking,
            "",
            "Thank you for shopping with BIG-B.",
          ]
            .filter(Boolean)
            .join("\n"),
  };
}

function paymentLabel(payment: string) {
  if (payment === "cod") return "Cash on delivery";
  return "Paid online";
}

async function sendEmail(
  input: OrderNotificationInput,
  recipientEmail: string | null,
  audience: NotificationAudience,
  contact: NotificationContact,
) {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM_EMAIL"];
  if (!apiKey || !from) {
    throw new NotificationConfigurationError("Resend server settings are missing");
  }
  if (!recipientEmail) throw new Error("The recipient email is unavailable");

  const details = orderDetails(input, audience, contact);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [recipientEmail],
      subject: details.subject,
      text: details.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}`);
}

async function deliver(
  channel: "email",
  orderId: string,
  send: () => Promise<void>,
): Promise<OrderNotificationResult["email"]> {
  try {
    await send();
    return "sent";
  } catch (error) {
    if (error instanceof NotificationConfigurationError) {
      console.error(`[Notifications] ${channel} is not configured for order ${orderId}`, error);
      return "not_configured";
    }
    console.error(`[Notifications] Could not send ${channel} for order ${orderId}`, error);
    return "failed";
  }
}

export async function sendOrderNotifications(
  input: OrderNotificationInput,
): Promise<OrderNotificationResult> {
  const customerContact: NotificationContact = {
    name: input.name,
    email: input.email ?? "",
  };
  const email = await deliver("email", input.orderId, () =>
    sendEmail(input, input.email, "customer", customerContact),
  );
  return { email };
}

export async function sendOwnerOrderNotifications(
  input: OrderNotificationInput,
  contact: NotificationContact,
): Promise<OrderNotificationResult> {
  const email = await deliver("email", input.orderId, () =>
    sendEmail(input, contact.email, "owner", contact),
  );
  return { email };
}
