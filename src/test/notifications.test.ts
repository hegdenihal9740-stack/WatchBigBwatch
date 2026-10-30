import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOrderNotifications, sendOwnerOrderNotifications } from "@/lib/notifications.server";
import { STORE_CONTACT } from "@/lib/store-info";

describe("order notifications", () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }),
  );

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "BIG-B <orders@example.test>");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends customer order email using the server-side provider", async () => {
    const result = await sendOrderNotifications({
      orderId: "PF0123456789ABCDEF0123",
      email: "customer@example.test",
      name: "Customer",
      mobile: "9876543210",
      total: 12800,
      items: [{ id: "steel", qty: 1 }],
      status: "confirmed",
      payment: "cod",
    });

    expect(result).toEqual({ email: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.resend.com/emails");
    const email = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      to: string[];
      text: string;
    };
    expect(email.to).toEqual(["customer@example.test"]);
    expect(email.text).toContain("Your BIG-B order PF0123456789ABCDEF0123");
  });

  it("sends owner order email with order details to the store contact", async () => {
    const result = await sendOwnerOrderNotifications(
      {
        orderId: "PF0123456789ABCDEF0123",
        email: "customer@example.test",
        name: "Customer",
        mobile: "9876543210",
        total: 12800,
        items: [{ id: "steel-watch", qty: 2 }],
        status: "confirmed",
        payment: "cod",
      },
      {
        name: STORE_CONTACT.name,
        email: STORE_CONTACT.email,
      },
    );

    expect(result).toEqual({ email: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const email = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(email.to).toEqual([STORE_CONTACT.email]);
    expect(email.subject).toContain("PF0123456789ABCDEF0123");
    expect(email.text).toContain("Customer: Customer");
    expect(email.text).toContain("Customer mobile: +91 9876543210");
    expect(email.text).toContain("Items: steel-watch x 2");
    expect(email.text).toContain("Payment: Cash on delivery");
  });

  it("reports missing Resend configuration without requiring SMS settings", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await sendOrderNotifications({
      orderId: "PF0123456789ABCDEF0123",
      email: "customer@example.test",
      name: "Customer",
      mobile: "9876543210",
      total: 12800,
      items: [{ id: "steel", qty: 1 }],
      status: "confirmed",
      payment: "cod",
    });

    expect(result).toEqual({ email: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("reports provider delivery failures separately from missing configuration", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await sendOrderNotifications({
      orderId: "PF0123456789ABCDEF0123",
      email: "customer@example.test",
      name: "Customer",
      mobile: "9876543210",
      total: 12800,
      items: [{ id: "steel", qty: 1 }],
      status: "confirmed",
      payment: "cod",
    });

    expect(result).toEqual({ email: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
