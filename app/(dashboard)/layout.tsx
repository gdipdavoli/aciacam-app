"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useCart } from '@/context/CartContext';
import styles from './dashboard.module.css';

import { 
    Home, 
    Flower2, 
    ShoppingBag, 
    User, 
    LogOut, 
    Leaf, 
    CheckCircle, 
    Calendar, 
    Bell, 
    Users, 
    Settings, 
    BarChart3,
    Package,
    Coins,
    DollarSign,
    MoreHorizontal
} from 'lucide-react';
import { NotificationService } from '@/services/notificationService';
// import { ChatWidget } from '@/app/components/ChatWidget';


export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, session, loading, authError, logout } = useAuth();
    const { itemCount } = useCart();
    const router = useRouter();

    const pathname = usePathname();
    const [unreadCount, setUnreadCount] = useState(0);
    const prevUnreadCountRef = React.useRef<number | null>(null);
    const [showMoreMenu, setShowMoreMenu] = useState(false);

    React.useEffect(() => {
        if (prevUnreadCountRef.current !== null && unreadCount > prevUnreadCountRef.current) {
            const playSound = () => {
                try {
                    const audio = new Audio('/sounds/notification.mp3');
                    audio.play().catch((error) => {
                        console.log('Notification sound autoplay was prevented by browser policies:', error);
                    });
                } catch (error) {
                    console.error('Audio initialization failed:', error);
                }
            };
            playSound();
        }
        prevUnreadCountRef.current = unreadCount;
    }, [unreadCount]);

    useEffect(() => {
        if (!user) return;

        const isAdmin = user.rol === 'admin' || user.rol === 'staff';
        const fetchCount = () => {
            NotificationService.getUnreadCount({ 
                socioId: !isAdmin ? user.id : undefined, 
                isAdminInbox: isAdmin 
            }).then(setUnreadCount);
        };

        fetchCount();
        // Poll every 2 minutes for new notifications
        const interval = setInterval(fetchCount, 120000);
        return () => clearInterval(interval);
    }, [user]);

    useEffect(() => {
        if (!loading && !user && !authError) {
            router.push('/login');
        }
    }, [user, loading, authError, router]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
                <p>Cargando sesión...</p>
            </div>
        );
    }

    if (!user) {
        if (authError) {
            return (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1.5rem', padding: '2rem', textAlign: 'center' }}>
                    <div style={{ backgroundColor: 'hsl(var(--destructive)/0.1)', color: 'hsl(var(--destructive))', padding: '1rem', borderRadius: '8px', border: '1px solid hsl(var(--destructive)/0.2)', maxWidth: '400px' }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Error de Conexión</p>
                        <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>{authError}</p>
                    </div>
                    <button 
                        onClick={() => window.location.reload()}
                        style={{ padding: '0.6rem 1.2rem', backgroundColor: 'hsl(var(--primary))', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                    >
                        Reintentar ahora
                    </button>
                    <button 
                        onClick={logout}
                        style={{ background: 'none', border: 'none', color: 'hsl(var(--muted-foreground))', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                        Volver al inicio
                    </button>
                </div>
            );
        }

        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
                <p>Redirigiendo al login...</p>
                <Link href="/login" style={{ textDecoration: 'underline' }}>Si no redirige, click aquí</Link>
            </div>
        );
    }

    // Define navigation based on role
    let navItems = [];

    if (user?.rol === 'admin' || user?.rol === 'staff') {
        navItems = [
            { href: '/admin/preparacion', label: 'Preparación', icon: Package },
            { href: '/admin', label: 'Pedidos', icon: ShoppingBag },
            { href: '/admin/products', label: 'Productos', icon: CheckCircle },
            { href: '/admin/notificaciones', label: 'Mensajes', icon: Bell, badge: unreadCount },
            { href: '/admin/socios', label: 'Socios', icon: User },
            { href: '/admin/pagos', label: 'Pagos / Caja', icon: Coins },
            { href: '/admin/estadisticas', label: 'Estadísticas', icon: BarChart3 },
            { href: '/admin/agenda', label: 'Agenda', icon: Calendar },
            { href: '/admin/configuracion', label: 'Configuración', icon: Settings },
        ];

        if (user.rol === 'admin') {
            navItems.push({ href: '/admin/equipo', label: 'Equipo', icon: Users });
        }
    } else {
        navItems = [
            { href: '/notificaciones', label: 'Notificaciones', icon: Bell, badge: unreadCount },
            { href: '/variedades', label: 'Opciones de tratamiento', icon: Flower2 },
            { href: '/pedidos', label: 'Mis Pedidos', icon: ShoppingBag },
            { href: '/cuenta', label: 'Mi Cuenta', icon: User },
        ];
    }

    return (
        <div className={styles.container}>
            {/* Desktop Sidebar */}
            <aside className={styles.sidebar}>
                <div className={styles.logo}>
                    <picture style={{ display: 'block', width: '100px', height: 'auto' }}>
                        <source srcSet="/logo-night.png" media="(prefers-color-scheme: dark)" />
                        <img src="/logo-day.png" alt="ACIACAM" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} />
                    </picture>
                </div>

                <nav className={styles.nav}>
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                            >
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <Icon size={20} />
                                    {item.badge !== undefined && item.badge > 0 && (
                                        <span style={{
                                            position: 'absolute',
                                            top: '-8px',
                                            right: '-8px',
                                            backgroundColor: 'hsl(var(--destructive))',
                                            color: 'white',
                                            borderRadius: '50%',
                                            width: '16px',
                                            height: '16px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '0.65rem',
                                            fontWeight: 700
                                        }}>
                                            {item.badge > 9 ? '9+' : item.badge}
                                        </span>
                                    )}
                                </div>
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}

                    {/* Cart Item - Only for Members */}
                    {user.rol !== 'admin' && user.rol !== 'staff' && (
                        <Link
                            href="/checkout"
                            className={`${styles.navItem} ${pathname === '/checkout' ? styles.navItemActive : ''}`}
                            style={{ marginTop: 'auto', marginBottom: '1rem' }}
                        >
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <ShoppingBag size={20} />
                                {itemCount > 0 && (
                                    <span style={{
                                        position: 'absolute',
                                        top: '-8px',
                                        right: '-8px',
                                        backgroundColor: 'hsl(var(--primary))',
                                        color: 'hsl(var(--primary-foreground))',
                                        borderRadius: '50%',
                                        width: '18px',
                                        height: '18px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '0.7rem',
                                        fontWeight: 700
                                    }}>
                                        {itemCount}
                                    </span>
                                )}
                            </div>
                            <span>Solicitud mensual</span>
                        </Link>
                    )}
                </nav>

                <div className={styles.userSection}>

                    <p style={{ fontSize: '0.8rem', paddingLeft: '0.5rem', marginBottom: '0.5rem', color: 'hsl(var(--muted-foreground))' }}>
                        {user.nombre} {user.apellido}
                        <br />
                        <span style={{ fontSize: '0.7rem', opacity: 0.7, textTransform: 'capitalize' }}>
                            {user.rol === 'admin' ? 'Administrador' : 'Socio'}
                        </span>
                    </p>
                    <button onClick={logout} className={styles.logoutBtn}>
                        <LogOut size={16} />
                        Cerrar Sesión
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className={styles.main}>
                {children}
            </main>

            {/* Mobile Bottom Nav */}
            <nav className={styles.mobileNav}>
                {(user?.rol === 'admin' || user?.rol === 'staff') ? (
                    <>
                        {/* 1. Preparación */}
                        <Link
                            href="/admin/preparacion"
                            className={`${styles.mobileNavItem} ${pathname === '/admin/preparacion' ? styles.mobileNavItemActive : ''}`}
                        >
                            <Package size={22} />
                            <span>Preparar</span>
                        </Link>

                        {/* 2. Pedidos */}
                        <Link
                            href="/admin"
                            className={`${styles.mobileNavItem} ${pathname === '/admin' ? styles.mobileNavItemActive : ''}`}
                        >
                            <ShoppingBag size={22} />
                            <span>Pedidos</span>
                        </Link>

                        {/* 3. Productos */}
                        <Link
                            href="/admin/products"
                            className={`${styles.mobileNavItem} ${pathname === '/admin/products' ? styles.mobileNavItemActive : ''}`}
                        >
                            <CheckCircle size={22} />
                            <span>Productos</span>
                        </Link>

                        {/* 4. Notificaciones */}
                        <Link
                            href="/admin/notificaciones"
                            className={`${styles.mobileNavItem} ${pathname === '/admin/notificaciones' ? styles.mobileNavItemActive : ''}`}
                        >
                            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <Bell size={22} />
                                {unreadCount > 0 && (
                                    <span style={{
                                        position: 'absolute',
                                        top: '-4px',
                                        right: '-4px',
                                        backgroundColor: 'hsl(var(--destructive))',
                                        color: 'white',
                                        borderRadius: '50%',
                                        width: '14px',
                                        height: '14px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '0.6rem',
                                        fontWeight: 700
                                    }}>
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                )}
                            </div>
                            <span>Mensajes</span>
                        </Link>

                        {/* 5. Más Drawer Button */}
                        <button
                            onClick={() => setShowMoreMenu(true)}
                            className={`${styles.mobileNavItem}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                            <MoreHorizontal size={22} />
                            <span>Más</span>
                        </button>
                    </>
                ) : (
                    // Regular Socio navigation
                    <>
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`${styles.mobileNavItem} ${isActive ? styles.mobileNavItemActive : ''}`}
                                >
                                    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <Icon size={22} />
                                        {item.badge !== undefined && item.badge > 0 && (
                                            <span style={{
                                                position: 'absolute',
                                                top: '-4px',
                                                right: '-4px',
                                                backgroundColor: 'hsl(var(--destructive))',
                                                color: 'white',
                                                borderRadius: '50%',
                                                width: '14px',
                                                height: '14px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '0.6rem',
                                                fontWeight: 700
                                            }}>
                                                {item.badge > 9 ? '9+' : item.badge}
                                            </span>
                                        )}
                                    </div>
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}

                        {/* Mobile Cart - Only for Members */}
                        {user.rol === 'socio' && (
                            <Link
                                href="/checkout"
                                className={`${styles.mobileNavItem} ${pathname === '/checkout' ? styles.mobileNavItemActive : ''}`}
                            >
                                <div style={{ position: 'relative' }}>
                                    <ShoppingBag size={22} />
                                    {itemCount > 0 && (
                                        <span style={{
                                            position: 'absolute',
                                            top: '-5px',
                                            right: '-5px',
                                            backgroundColor: 'hsl(var(--primary))',
                                            color: 'hsl(var(--primary-foreground))',
                                            borderRadius: '50%',
                                            width: '16px',
                                            height: '16px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '0.65rem',
                                            fontWeight: 700
                                        }}>
                                            {itemCount}
                                        </span>
                                    )}
                                </div>
                                <span>Solicitud</span>
                            </Link>
                        )}

                        {/* Mobile Logout */}
                        <button
                            onClick={logout}
                            className={styles.mobileNavItem}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                            <LogOut size={22} color="hsl(var(--destructive))" />
                            <span style={{ color: 'hsl(var(--destructive))' }}>Salir</span>
                        </button>
                    </>
                )}
            </nav>

            {/* Bottom Drawer Overlay for Admin/Staff "Más" */}
            {showMoreMenu && (user?.rol === 'admin' || user?.rol === 'staff') && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center md:hidden"
                    onClick={() => setShowMoreMenu(false)}
                >
                    <div 
                        className="bg-card w-full max-w-md rounded-t-2xl shadow-2xl border-t border-border p-6 pb-8 animate-in slide-in-from-bottom duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drag handle */}
                        <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-6 opacity-60"></div>
                        
                        {/* User Header */}
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b">
                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                                {user?.nombre?.[0] || ''}{user?.apellido?.[0] || ''}
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-foreground leading-none mb-1.5">{user?.nombre} {user?.apellido}</h4>
                                <span className="text-[10px] uppercase font-black text-muted-foreground tracking-wider">{user?.rol === 'admin' ? 'Administrador' : 'Staff'}</span>
                            </div>
                        </div>

                        {/* Drawer Secondary Navigation Grid */}
                        <div className="grid grid-cols-2 gap-3 mb-6">
                            <Link
                                href="/admin/socios"
                                onClick={() => setShowMoreMenu(false)}
                                className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                                    pathname === '/admin/socios'
                                        ? 'bg-primary/10 border-primary text-primary'
                                        : 'bg-card hover:bg-muted/40 border-border text-foreground'
                                }`}
                            >
                                <User size={16} />
                                <span>Socios</span>
                            </Link>

                            <Link
                                href="/admin/estadisticas"
                                onClick={() => setShowMoreMenu(false)}
                                className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                                    pathname === '/admin/estadisticas'
                                        ? 'bg-primary/10 border-primary text-primary'
                                        : 'bg-card hover:bg-muted/40 border-border text-foreground'
                                }`}
                            >
                                <BarChart3 size={16} />
                                <span>Estadísticas</span>
                            </Link>

                            <Link
                                href="/admin/pagos"
                                onClick={() => setShowMoreMenu(false)}
                                className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                                    pathname === '/admin/pagos'
                                        ? 'bg-primary/10 border-primary text-primary'
                                        : 'bg-card hover:bg-muted/40 border-border text-foreground'
                                }`}
                            >
                                <DollarSign size={16} />
                                <span>Pagos / Caja</span>
                            </Link>

                            <Link
                                href="/admin/agenda"
                                onClick={() => setShowMoreMenu(false)}
                                className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                                    pathname === '/admin/agenda'
                                        ? 'bg-primary/10 border-primary text-primary'
                                        : 'bg-card hover:bg-muted/40 border-border text-foreground'
                                }`}
                            >
                                <Calendar size={16} />
                                <span>Agenda</span>
                            </Link>

                            <Link
                                href="/admin/configuracion"
                                onClick={() => setShowMoreMenu(false)}
                                className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                                    pathname === '/admin/configuracion'
                                        ? 'bg-primary/10 border-primary text-primary'
                                        : 'bg-card hover:bg-muted/40 border-border text-foreground'
                                }`}
                            >
                                <Settings size={16} />
                                <span>Configuración</span>
                            </Link>

                            {user.rol === 'admin' && (
                                <Link
                                    href="/admin/equipo"
                                    onClick={() => setShowMoreMenu(false)}
                                    className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                                        pathname === '/admin/equipo'
                                            ? 'bg-primary/10 border-primary text-primary'
                                            : 'bg-card hover:bg-muted/40 border-border text-foreground'
                                    }`}
                                >
                                    <Users size={16} />
                                    <span>Equipo</span>
                                </Link>
                            )}
                        </div>

                        {/* Logout & Close buttons */}
                        <div className="pt-4 border-t flex flex-col gap-2">
                            <button
                                onClick={() => {
                                    setShowMoreMenu(false);
                                    logout();
                                }}
                                className="w-full py-3.5 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <LogOut size={16} />
                                Cerrar Sesión
                            </button>
                            <button
                                onClick={() => setShowMoreMenu(false)}
                                className="w-full py-3.5 bg-muted text-muted-foreground hover:bg-muted/80 rounded-xl text-xs font-bold transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Chat Widget - DISABLED for Production Stability */}
            {/* {user && session?.access_token && <ChatWidget key={session.access_token} />} */}

        </div>
    );
}
