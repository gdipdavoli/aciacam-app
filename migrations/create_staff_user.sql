-- Create or Update Staff User (Safe Method)
-- UID: 9980b7f6-5964-473b-b901-bcdc0c6fea14
-- Email: medialimagen@gmail.com

DO $$
BEGIN
    -- 1. Try to update if exists
    UPDATE public.socios 
    SET 
        rol = 'staff', 
        user_id = '9980b7f6-5964-473b-b901-bcdc0c6fea14',
        nombre = 'Staff',
        apellido = 'Prueba'
    WHERE email = 'medialimagen@gmail.com';

    -- 2. If no row was updated, insert new
    IF NOT FOUND THEN
        INSERT INTO public.socios (
            nombre, 
            apellido, 
            dni, 
            email, 
            rol, 
            user_id, 
            telefono
        )
        VALUES (
            'Staff', 
            'Prueba', 
            'STAFF-01', 
            'medialimagen@gmail.com', 
            'staff', 
            '9980b7f6-5964-473b-b901-bcdc0c6fea14',
            '000-0000'
        );
    END IF;
END $$;
