ALTER TABLE public.razorpay_payment_orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'razorpay',
  ADD COLUMN IF NOT EXISTS razorpay_qr_code_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'razorpay_payment_orders_payment_method_check'
      AND conrelid = 'public.razorpay_payment_orders'::regclass
  ) THEN
    ALTER TABLE public.razorpay_payment_orders
      ADD CONSTRAINT razorpay_payment_orders_payment_method_check
      CHECK (payment_method IN ('razorpay', 'upi', 'qr'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'razorpay_payment_orders_provider_reference_check'
      AND conrelid = 'public.razorpay_payment_orders'::regclass
  ) THEN
    ALTER TABLE public.razorpay_payment_orders
      ADD CONSTRAINT razorpay_payment_orders_provider_reference_check
      CHECK (
        NOT (
          razorpay_order_id IS NOT NULL
          AND razorpay_qr_code_id IS NOT NULL
        )
        AND (razorpay_qr_code_id IS NULL OR payment_method = 'qr')
        AND (razorpay_order_id IS NULL OR payment_method IN ('razorpay', 'upi'))
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS razorpay_payment_orders_qr_code_id_idx
  ON public.razorpay_payment_orders (razorpay_qr_code_id)
  WHERE razorpay_qr_code_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finalize_razorpay_payment(
  _order_id text,
  _payment_status text,
  _payment_id text DEFAULT NULL,
  _event_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment_order public.razorpay_payment_orders;
  inserted_rows integer;
  created_now boolean := false;
BEGIN
  IF _payment_status NOT IN ('pending', 'paid', 'failed') THEN
    RAISE EXCEPTION 'Invalid Razorpay payment status';
  END IF;

  SELECT * INTO payment_order
  FROM public.razorpay_payment_orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Razorpay payment order not found';
  END IF;

  IF _event_id IS NOT NULL THEN
    INSERT INTO public.razorpay_webhook_events (event_id, payment_order_id)
    VALUES (_event_id, payment_order.id)
    ON CONFLICT (event_id) DO NOTHING;
    GET DIAGNOSTICS inserted_rows = ROW_COUNT;
    IF inserted_rows = 0 THEN
      RETURN jsonb_build_object(
        'order_id', payment_order.id,
        'payment_status', payment_order.status,
        'confirmed_now', false,
        'duplicate_event', true
      );
    END IF;
  END IF;

  IF payment_order.status IN ('paid', 'paid_review') THEN
    IF payment_order.payment_id IS DISTINCT FROM _payment_id
      AND _payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Razorpay payment does not match the recorded payment';
    END IF;
    RETURN jsonb_build_object(
      'order_id', payment_order.id,
      'payment_status', payment_order.status,
      'confirmed_now', false
    );
  END IF;

  IF _payment_status = 'paid' THEN
    IF _payment_id IS NULL OR length(_payment_id) = 0
      OR (
        payment_order.razorpay_order_id IS NULL
        AND payment_order.razorpay_qr_code_id IS NULL
      ) THEN
      RAISE EXCEPTION 'Verified Razorpay payment and provider reference IDs are required';
    END IF;

    BEGIN
      INSERT INTO public.orders (
        id, user_id, items, total, payment, payment_reference, address
      )
      VALUES (
        payment_order.id,
        payment_order.user_id,
        payment_order.items,
        payment_order.total,
        'razorpay',
        _payment_id,
        payment_order.address
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE 'OUT_OF_STOCK:%' THEN
          UPDATE public.razorpay_payment_orders
          SET status = 'paid_review',
              payment_id = _payment_id,
              updated_at = now()
          WHERE id = payment_order.id;

          RETURN jsonb_build_object(
            'order_id', payment_order.id,
            'payment_status', 'paid_review',
            'confirmed_now', false
          );
        END IF;
        RAISE;
    END;

    UPDATE public.razorpay_payment_orders
    SET status = 'paid',
        payment_id = _payment_id,
        updated_at = now()
    WHERE id = payment_order.id;

    IF payment_order.clear_cart THEN
      UPDATE public.customer_carts
      SET items = '[]'::jsonb, updated_at = now()
      WHERE user_id = payment_order.user_id;
    END IF;
    created_now := true;
  ELSIF _payment_status = 'pending' THEN
    UPDATE public.razorpay_payment_orders
    SET status = 'pending',
        payment_id = COALESCE(_payment_id, payment_id),
        updated_at = now()
    WHERE id = payment_order.id AND status = 'creating';
  ELSE
    UPDATE public.razorpay_payment_orders
    SET status = 'failed',
        payment_id = COALESCE(_payment_id, payment_id),
        updated_at = now()
    WHERE id = payment_order.id AND status IN ('creating', 'pending');
  END IF;

  SELECT * INTO payment_order
  FROM public.razorpay_payment_orders
  WHERE id = _order_id;

  RETURN jsonb_build_object(
    'order_id', payment_order.id,
    'payment_status', payment_order.status,
    'confirmed_now', created_now
  );
END
$$;

REVOKE ALL ON FUNCTION public.finalize_razorpay_payment(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_razorpay_payment(text, text, text, text)
  TO service_role;
