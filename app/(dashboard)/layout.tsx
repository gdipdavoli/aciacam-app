"use client";

import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useCart } from '@/context/CartContext';
import styles from './dashboard.module.css';

import { Home, Flower2, ShoppingBag, User, LogOut, Leaf, CheckCircle } from 'lucide-react';


export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, loading, logout } = useAuth();
    const { itemCount } = useCart();
    const router = useRouter();

    const pathname = usePathname();

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    if (loading || !user) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <p>Cargando...</p>
            </div>
        );
    }

    // Define navigation based on role
    let navItems = [];

    if (user.rol === 'admin') {
        navItems = [
            { href: '/admin', label: 'Pedidos', icon: ShoppingBag }, // Admin "Home" is Orders
            { href: '/variedades', label: 'Catálogo', icon: Flower2 },
            { href: '/admin/products', label: 'Productos', icon: CheckCircle },
            { href: '/admin/socios', label: 'Socios', icon: User },
        ];
    } else {
        navItems = [
            { href: '/', label: 'Inicio', icon: Home },
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
                    <Leaf size={24} />
                    <span>ACIACAM</span>
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
                                <Icon size={20} />
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}

                    {/* Cart Item - Only for Members */}
                    {user.rol !== 'admin' && (
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
                            <Icon size={22} />
                            <span>{item.label}</span>
                        </Link>
                    );
                })}

                {/* Mobile Cart - Only for Members */}
                {user.rol !== 'admin' && (
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

        </div>
    );
}
