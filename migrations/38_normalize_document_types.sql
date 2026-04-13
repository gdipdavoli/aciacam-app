-- Migration 38: Document Type Normalization
-- Harmonizing "Human Readable" keys with "System" snake_case keys

UPDATE public.documentos_socio
SET tipo = CASE 
    WHEN lower(tipo) LIKE '%declaracion%jurada%' THEN 'declaracion_jurada'
    WHEN lower(tipo) LIKE '%consentimiento%' THEN 'consentimiento'
    WHEN lower(tipo) LIKE '%reprocann%' THEN 'reprocann'
    WHEN lower(tipo) LIKE '%contrato%' THEN 'contrato'
    ELSE lower(replace(tipo, ' ', '_'))
END
WHERE tipo NOT IN ('declaracion_jurada', 'consentimiento', 'reprocann', 'contrato');

-- Ensure no trailing or leading whitespace
UPDATE public.documentos_socio SET tipo = trim(tipo);
