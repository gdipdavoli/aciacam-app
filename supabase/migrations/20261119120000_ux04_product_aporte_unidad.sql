-- UX-04: Aporte unitario independiente del peso en gramos para aceites/goteros
-- Se aplica exclusivamente en PostgreSQL local (sin modificar Producción ni Integration)

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS aporte_unidad numeric;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_aporte_unidad_non_negative'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_aporte_unidad_non_negative
            CHECK (aporte_unidad IS NULL OR aporte_unidad >= 0);
    END IF;
END $$;

COMMENT ON COLUMN public.products.aporte_unidad IS
    'Aporte unitario en ARS por frasco/unidad (aceites/goteros), independiente de peso_gramos.';
