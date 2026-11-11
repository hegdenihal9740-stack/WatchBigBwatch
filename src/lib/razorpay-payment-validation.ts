export type RazorpayPaymentRecord = {
  id: string;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  order_id: string | null;
  method: string | null;
};

export function validateRazorpayOrderPayment(
  payment: RazorpayPaymentRecord,
  orderId: string | null,
  expectedTotal: number,
): void {
  if (
    !orderId ||
    payment.order_id !== orderId ||
    payment.amount !== expectedTotal * 100 ||
    payment.currency !== "INR"
  ) {
    throw new Error("Razorpay payment amount, currency, or order does not match.");
  }
}
