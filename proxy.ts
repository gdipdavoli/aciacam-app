import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Proxy de Seguridad para ACIACAM (anteriormente Middleware)
 * 1. Gestiona la sesión de Supabase (refresh).
 * 2. Protege rutas administrativas (/admin/*).
 * 3. Inyecta Headers de seguridad.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // 1. Refresh de sesión
  const { data: { session } } = await supabase.auth.getSession();

  // 2. Protección de rutas administrativas (/admin/* y /api/admin/*)
  const isPathAdmin = request.nextUrl.pathname.startsWith('/admin');
  const isApiAdmin = request.nextUrl.pathname.startsWith('/api/admin');

  if (isPathAdmin || isApiAdmin) {
    if (!session) {
      // Si es una petición de API, retornamos JSON en vez de redirect
      if (isApiAdmin) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }
    
    // Validación de rol básica (metadata de Supabase)
    const role = session.user.app_metadata?.role || session.user.user_metadata?.role;
    if (role !== 'admin' && role !== 'staff') {
      if (isApiAdmin) {
        return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // 3. Headers de Seguridad
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocations=()');
  
  // Content Security Policy (Básico - Ajustar según necesidades de assets externos)
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://*.vercel-storage.com;"
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public assets)
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
