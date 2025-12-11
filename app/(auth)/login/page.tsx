"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import styles from './login.module.css';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const [step, setStep] = useState<'contact' | 'code'>('contact');
    const [contact, setContact] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { login, verify, user } = useAuth();
    const router = useRouter();

    // Redirect if already logged in
    useEffect(() => {
        if (user) {
            if (user.rol === 'admin') {
                router.push('/admin');
            } else {
                router.push('/');
            }
        }
    }, [user, router]);


    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            if (!contact.trim()) {
                throw new Error('Por favor ingresa tu email o teléfono');
            }

            const success = await login(contact);
            if (success) {
                setStep('code');
            } else {
                setError('No pudimos enviar el código. Intenta nuevamente.');
            }
        } catch (err: any) {
            setError(err.message || 'Ocurrió un error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            const success = await verify(contact, code);
            if (success) {
                // Redirect handled by useEffect, but for good UX we can also push here if we access user
                // But useEffect is robust.
            } else {
                setError('Código incorrecto. Intenta "123456"'); // Hint for mock
            }
        } catch (err: any) {
            setError(err.message || 'Error al verificar');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.header}>
                    <h1 className={styles.title}>ACIACAM</h1>
                    <p className={styles.subtitle}>
                        {step === 'contact'
                            ? 'Ingresa tus datos para continuar'
                            : 'Ingresa el código enviado'}
                    </p>
                </div>

                {error && <div className={styles.error}>{error}</div>}

                {step === 'contact' ? (
                    <form onSubmit={handleSendCode} className={styles.form}>
                        <div className={styles.inputGroup}>
                            <label htmlFor="contact" className={styles.label}>
                                Email o Teléfono
                            </label>
                            <input
                                id="contact"
                                type="text"
                                placeholder="ej. juan@email.com"
                                className={styles.input}
                                value={contact}
                                onChange={(e) => setContact(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <button
                            type="submit"
                            className={`${styles.button} ${styles.buttonPrimary}`}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Enviando...' : 'Pedir Código'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleVerify} className={styles.form}>
                        <div className={styles.inputGroup}>
                            <label htmlFor="code" className={styles.label}>
                                Código de verificación
                            </label>
                            <input
                                id="code"
                                type="text"
                                placeholder="123456"
                                className={styles.input}
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <button
                            type="submit"
                            className={`${styles.button} ${styles.buttonPrimary}`}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Verificando...' : 'Ingresar'}
                        </button>

                        <button
                            type="button"
                            className={`${styles.button} ${styles.buttonSecondary}`}
                            onClick={() => {
                                setStep('contact');
                                setError('');
                            }}
                        >
                            Volver atrás
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

