-- DEMOTE barrioterralta@gmail.com to SOCIO
-- This user was incorrectly promoted to admin in the previous migration (14).

UPDATE public.socios
SET rol = 'socio'
WHERE email = 'barrioterralta@gmail.com';
