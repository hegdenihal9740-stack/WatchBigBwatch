export type RazorpayPaymentRecord = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  method?: string;
};

export function validateRazorpayOrderPayment(
  payment: RazorpayPaymentRecord,
  orderId: string | null,
  total: number,
) {
  if (
    !orderId ||
    payment.order_id !== orderId ||
    payment.amount !== total * 100 ||
    payment.currency !== "INR"
  ) {
    throw new Error("Razorpay payment amount, currency, or order does not match.");
  }
}

export function validateRazorpayQrPayment(
  payment: RazorpayPaymentRecord,
  total: number,
) {
  if (
    payment.order_id !== null ||
    payment.method !== "upi" ||
    payment.amount !== total * 100 ||
    payment.currency !== "INR"
  ) {
    throw new Error("Razorpay QR payment amount, currency, or method does not match.");
  }
}
