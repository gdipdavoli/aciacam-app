import { SocioSummaryDTO } from '@/types/inbox';

/**
 * Retorna el nombre y apellido formateados del socio, degradando elegantemente si faltan datos.
 */
export function formatSocioName(socio?: SocioSummaryDTO | null): string {
  if (!socio) return '';
  const nom = (socio.nombre || '').trim();
  const ape = (socio.apellido || '').trim();

  if (nom && ape) return `${nom} ${ape}`;
  if (nom) return nom;
  if (ape) return ape;
  return '';
}

/**
 * Retorna el texto representativo del DNI enmascarado proveniente de Agent Core.
 * No vuelve a enmascarar en frontend; consume directamente dni_masked.
 */
export function formatDniMasked(dniMasked?: string | null): string {
  if (!dniMasked) return '';
  const trimmed = dniMasked.trim();
  if (!trimmed) return '';
  if (trimmed.toUpperCase().startsWith('DNI')) {
    return trimmed;
  }
  return `DNI ${trimmed}`;
}

/**
 * Combina el nombre del socio con su DNI enmascarado.
 * Ejemplo: "Nombre Apellido · DNI ••••1234"
 */
export function formatSocioDisplay(socio?: SocioSummaryDTO | null): string | null {
  if (!socio) return null;

  const name = formatSocioName(socio);
  const dni = formatDniMasked(socio.dni_masked);

  if (name && dni) {
    return `${name} · ${dni}`;
  }
  if (name) {
    return name;
  }
  if (dni) {
    return dni;
  }
  return null;
}

/**
 * Retorna las etiquetas en español para los estados canónicos de la bandeja.
 */
export function getStatusLabel(status?: string | null): string {
  if (!status) return 'Pendiente de aprobación';
  const upper = status.toUpperCase();

  switch (upper) {
    case 'AWAITING_APPROVAL':
    case 'PENDING':
      return 'Pendiente de aprobación';
    case 'APPROVED':
      return 'Aprobada';
    case 'DELIVERING':
      return 'Enviando';
    case 'SENT':
      return 'Enviada';
    case 'FAILED':
      return 'Falló el envío';
    case 'IN_REVIEW':
      return 'En revisión';
    default:
      return status;
  }
}
