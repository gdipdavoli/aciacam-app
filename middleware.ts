import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware de Seguridad para ACIACAM
 */
export async function middleware(request: NextRequest) {
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
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  // Optimizamos: Solo hacemos getSession si es una ruta protegida
  const isPathAdmin = request.nextUrl.pathname.startsWith('/admin');
  const isApiAdmin = request.nextUrl.pathname.startsWith('/api/admin');

  if (isPathAdmin || isApiAdmin) {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      if (isApiAdmin) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }
    
    const role = session.user.app_metadata?.role || session.user.user_metadata?.role;
    if (role !== 'admin' && role !== 'staff') {
      if (isApiAdmin) {
        return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // Headers de Seguridad - Relajamos CSP para evitar bloqueos de PWA/Service Worker
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // CSP más permisivo para asegurar que carguen todos los assets de Vercel y PWA
  response.headers.set(
    'Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; font-src * data:; connect-src *;"
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
