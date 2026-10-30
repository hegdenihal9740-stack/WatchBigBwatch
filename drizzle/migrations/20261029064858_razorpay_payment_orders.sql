CREATE TABLE public.razorpay_payment_orders (
  id text PRIMARY KEY CHECK (id ~ '^PF[A-F0-9]{20}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  total integer NOT NULL CHECK (total > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  address jsonb NOT NULL CHECK (jsonb_typeof(address) = 'object'),
  clear_cart boolean NOT NULL DEFAULT true,
  razorpay_order_id text UNIQUE,
  payment_id text UNIQUE,
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'pending', 'paid', 'paid_review', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

ALTER TABLE public.razorpay_payment_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_payment_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.razorpay_payment_orders TO service_role;

CREATE INDEX razorpay_payment_orders_user_created_idx
  ON public.razorpay_payment_orders (user_id, created_at DESC);

CREATE TABLE public.razorpay_webhook_events (
  event_id text PRIMARY KEY,
  payment_order_id text NOT NULL REFERENCES public.razorpay_payment_orders(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.razorpay_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.razorpay_webhook_events TO service_role;

CREATE UNIQUE INDEX orders_razorpay_payment_reference_idx
  ON public.orders (payment_reference)
  WHERE payment = 'razorpay' AND payment_reference IS NOT NULL;

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
      OR payment_order.razorpay_order_id IS NULL THEN
      RAISE EXCEPTION 'Verified Razorpay payment and order IDs are required';
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

CREATE OR REPLACE FUNCTION public.cancel_order(_order_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o public.orders;
  l jsonb;
  is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO o
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND OR o.status = 'cancelled' OR o.payment = 'razorpay' THEN
    RETURN false;
  END IF;

  is_admin := public.has_role(auth.uid(), 'admin');
  IF NOT is_admin AND (o.user_id <> auth.uid() OR o.status NOT IN ('confirmed', 'packed')) THEN
    RETURN false;
  END IF;

  IF o.status <> 'delivered' THEN
    FOR l IN SELECT * FROM jsonb_array_elements(o.items) LOOP
      UPDATE public.inventory
      SET stock = stock + (l->>'qty')::int, updated_at = now()
      WHERE watch_id = l->>'id';
    END LOOP;
  END IF;

  UPDATE public.orders
  SET status = 'cancelled'
  WHERE id = _order_id;

  RETURN true;
END
$$;