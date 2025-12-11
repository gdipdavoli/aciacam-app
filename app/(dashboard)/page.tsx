"use client";

import { useAuth } from '@/context/AuthContext';
import styles from './dashboard.module.css';

// We can recycle some dashboard styles or create new ones. 
// For now, let's use inline for specific page content or reuse globals.

export default function DashboardHome() {
    const { user } = useAuth();

    return (
        <div>
            <header style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Hola, {user?.nombre} 👋</h1>
                <p style={{ color: 'hsl(var(--muted-foreground))' }}>Bienvenido a la plataforma de socios de ACIACAM.</p>
            </header>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1.5rem'
            }}>
                {/* Quick Actions Cards */}
                <div style={{
                    backgroundColor: 'hsl(var(--card))',
                    padding: '1.5rem',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.05)'
                }}>
                    <h3 style={{ marginBottom: '1rem' }}>Hacer un pedido</h3>
                    <p style={{ marginBottom: '1.5rem', color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                        Explora nuestras variedades y solicitá retiro en sede o delivery.
                    </p>
                    <a href="/variedades" style={{
                        display: 'inline-block',
                        backgroundColor: 'hsl(var(--primary))',
                        color: 'hsl(var(--primary-foreground))',
                        padding: '0.75rem 1.5rem',
                        borderRadius: 'var(--radius)',
                        fontSize: '0.9rem',
                        fontWeight: 600
                    }}>
                        Ver Variedades
                    </a>
                </div>

                <div style={{
                    backgroundColor: 'hsl(var(--card))',
                    padding: '1.5rem',
                    borderRadius: 'var(--radius)',
                    border: '1px solid hsl(var(--border))',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.05)'
                }}>
                    <h3 style={{ marginBottom: '1rem' }}>Mi Estado</h3>
                    <p style={{ marginBottom: '0.5rem', color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                        Estado de cuenta: <span style={{ color: 'hsl(var(--primary))', fontWeight: 'bold' }}>Al día</span>
                    </p>
                    <p style={{ marginBottom: '1.5rem', color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
                        Último pago: {user?.estadoCuenta.ultimaCuotaPaga}
                    </p>
                    <a href="/cuenta" style={{
                        display: 'inline-block',
                        backgroundColor: 'transparent',
                        border: '1px solid hsl(var(--border))',
                        color: 'hsl(var(--foreground))',
                        padding: '0.75rem 1.5rem',
                        borderRadius: 'var(--radius)',
                        fontSize: '0.9rem',
                        fontWeight: 600
                    }}>
                        Ver Detalles
                    </a>
                </div>
            </div>
        </div>
    );
}
