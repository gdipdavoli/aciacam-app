import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware de Emergencia - Desactivado para restaurar acceso
 */
export async function middleware(request: NextRequest) {
  // Retornamos directamente para evitar cualquier interferencia con el Service Worker o el Login
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
