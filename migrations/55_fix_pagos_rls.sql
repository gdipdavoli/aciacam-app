-- 1. Enable RLS on pagos table (just in case)
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies on pagos to avoid conflicts
DROP POLICY IF EXISTS "Admins and Staff can manage all pagos" ON public.pagos;
DROP POLICY IF EXISTS "Socios can view their own pagos" ON public.pagos;
DROP POLICY IF EXISTS "Admins and Staff can insert pagos" ON public.pagos;
DROP POLICY IF EXISTS "Allow insert for staff" ON public.pagos;
DROP POLICY IF EXISTS "Allow select for staff" ON public.pagos;
DROP POLICY IF EXISTS "Allow update for staff" ON public.pagos;
DROP POLICY IF EXISTS "Allow delete for staff" ON public.pagos;

-- 3. Create Policy: Admins and Staff have FULL access to manage all payments
CREATE POLICY "Admins and Staff can manage all pagos"
ON public.pagos
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.socios
    WHERE socios.user_id = auth.uid()
    AND socios.rol IN ('admin', 'staff')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.socios
    WHERE socios.user_id = auth.uid()
    AND socios.rol IN ('admin', 'staff')
  )
);

-- 4. Create Policy: Socios can view their own payments (Read-Only)
CREATE POLICY "Socios can view their own pagos"
ON public.pagos
FOR SELECT
TO authenticated
USING (
  socio_id = (
    SELECT id FROM public.socios
    WHERE socios.user_id = auth.uid()
    LIMIT 1
  )
);
