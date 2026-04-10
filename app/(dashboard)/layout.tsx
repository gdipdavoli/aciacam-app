"use client";

import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useCart } from '@/context/CartContext';
import styles from './dashboard.module.css';

import { Home, Flower2, ShoppingBag, User, LogOut, Leaf, CheckCircle, Calendar, Bell } from 'lucide-react';
import { NotificationService } from '@/services/notificationService';
// import { ChatWidget } from '@/app/components/ChatWidget'; // DISABLED for Production


export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, session, loading, logout } = useAuth();
    const { itemCount } = useCart();
    const router = useRouter();

    const pathname = usePathname();
    const [unreadCount, setUnreadCount] = React.useState(0);

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
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
                <p>Cargando sesión...</p>
            </div>
        );
    }

    if (!user) {
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
            { href: '/admin/notificaciones', label: 'Mensajes', icon: Bell, badge: unreadCount },
            { href: '/admin', label: 'Pedidos', icon: ShoppingBag },
            { href: '/variedades', label: 'Catálogo', icon: Flower2 },
            { href: '/admin/products', label: 'Productos', icon: CheckCircle },
            { href: '/admin/socios', label: 'Socios', icon: User },
            { href: '/admin/agenda', label: 'Agenda', icon: Calendar },
        ];
    } else {
        navItems = [
            { href: '/notificaciones', label: 'Notificaciones', icon: Bell, badge: unreadCount },
            { href: '/variedades', label: 'Variedades', icon: Flower2 },
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
                            <span>Tu Carrito</span>
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
                {user.rol !== 'admin' && user.rol !== 'staff' && (
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
                        <span>Carrito</span>
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
            </nav>

            {/* Chat Widget - DISABLED for Production Stability */}
            {/*
            {user && session?.access_token && <ChatWidget key={session.access_token} />}
            */}

        </div>
    );
}
