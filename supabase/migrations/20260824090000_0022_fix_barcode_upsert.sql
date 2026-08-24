-- =============================================================================
-- Green ERP — 0022 Fix the §3.13 rule 5 barcode check on upsert paths
--
-- `app.assert_barcode_unique` excluded the row being written with `id <> new.id`.
-- That is correct for a plain INSERT and for an UPDATE, but wrong for
-- `INSERT ... ON CONFLICT DO UPDATE`:
--
--   The BEFORE INSERT trigger fires *before* the conflict is detected, so
--   `new.id` holds a freshly generated uuid rather than the id of the row that
--   is about to be updated. The function then finds the existing row — the same
--   logical product — decides it is "another item", and raises.
--
--   The result: re-importing a product with its own unchanged barcode fails.
--   That breaks the §3.12 `products.import` path and any idempotent seed.
--
-- The fix is to identify "another item" by its **natural key** instead of its
-- surrogate one. SKU is already unique per merchant (§3.13 rule 3), so
-- `sku <> new.sku` expresses the rule the spec actually states — "two different
-- items may not share a barcode" — and is stable regardless of whether the row
-- is arriving as an insert, an update, or an upsert.
--
-- The rule itself is unchanged: two genuinely different SKUs still cannot share
-- a barcode unless the company opts in.
-- =============================================================================

create or replace function app.assert_barcode_unique()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
  v_clash   boolean;
begin
  if new.barcode is null or new.barcode = '' then
    return new;
  end if;

  select coalesce((settings -> 'catalog' ->> 'allow_duplicate_barcodes')::boolean, false)
    into v_allowed
  from public.companies
  where id = new.company_id;

  if v_allowed then
    return new;
  end if;

  -- Compared on SKU, not id: see the header. `id <> new.id` is kept as a second
  -- guard so a row can never clash with itself even if two SKUs were somehow
  -- equal.
  if tg_table_name = 'products' then
    select exists (
      select 1 from public.products
      where merchant_id = new.merchant_id
        and barcode = new.barcode
        and sku <> new.sku
        and id <> new.id
    ) into v_clash;
  else
    select exists (
      select 1 from public.product_variants
      where merchant_id = new.merchant_id
        and barcode = new.barcode
        and sku <> new.sku
        and id <> new.id
    ) into v_clash;
  end if;

  if v_clash then
    raise exception
      'Barcode % is already used by another item for this merchant (spec §3.13 rule 5)', new.barcode
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

comment on function app.assert_barcode_unique is
  '§3.13 rule 5. Identifies "another item" by SKU rather than id, so the check survives INSERT ... ON CONFLICT DO UPDATE.';
