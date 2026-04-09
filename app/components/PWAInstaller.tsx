'use client';

import { useState, useEffect } from 'react';

export default function PWAInstaller() {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isIOS, setIsIOS] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [showIOSInstructions, setShowIOSInstructions] = useState(false);

    useEffect(() => {
        // Detectar si ya está instalada
        const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches 
            || (window.navigator as any).standalone 
            || document.referrer.includes('android-app://');
        
        setIsStandalone(isStandaloneMode);

        // Detectar iOS
        const userAgent = window.navigator.userAgent.toLowerCase();
        const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
        setIsIOS(isIOSDevice);

        // Capturar evento de instalación en Android / Chrome
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // Registrar Service Worker si no está registrado
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('SW registrado:', reg.scope))
                .catch(err => console.error('Error SW:', err));
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstallClick = async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to install prompt: ${outcome}`);
            setDeferredPrompt(null);
        } else if (isIOS) {
            setShowIOSInstructions(true);
        }
    };

    // Si ya está instalada, no mostramos nada
    if (isStandalone) return null;

    // Si no es iOS y no hay prompt diferido (y no es standalone), 
    // podrías querer ocultarlo o mostrar algo genérico.
    // Pero en Android/Chrome a veces el prompt tarda un poco.
    if (!deferredPrompt && !isIOS) return null;

    return (
        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button
                id="btnInstalar"
                onClick={handleInstallClick}
                style={{
                    width: '100%',
                    padding: '1rem',
                    backgroundColor: '#0056b3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem'
                }}
            >
                <InstallIcon />
                AGREGAR APLICACIÓN A MI CELULAR
            </button>

            {showIOSInstructions && (
                <div style={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    padding: '1.5rem',
                    borderTopLeftRadius: '20px',
                    borderTopRightRadius: '20px',
                    boxShadow: '0 -10px 25px rgba(0,0,0,0.1)',
                    zIndex: 9999,
                    color: '#333',
                    textAlign: 'left'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Instalar en iPhone</h3>
                        <button onClick={() => setShowIOSInstructions(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                    </div>
                    <p style={{ fontSize: '0.95rem', lineHeight: '1.4', marginBottom: '1rem' }}>
                        Para instalar ACIACAM en tu iPhone:
                    </p>
                    <ol style={{ paddingLeft: '1.2rem', fontSize: '0.95rem', lineHeight: '1.6' }}>
                        <li>Toca el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba <ShareIcon />) en la barra inferior de Safari.</li>
                        <li>Desliza hacia abajo y selecciona <strong>"Agregar al inicio"</strong>.</li>
                        <li>Toca <strong>"Agregar"</strong> en la esquina superior derecha.</li>
                    </ol>
                    <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                        <button 
                            onClick={() => setShowIOSInstructions(false)}
                            style={{ padding: '0.6rem 2rem', backgroundColor: '#f0f0f0', border: 'none', borderRadius: '20px', fontWeight: 600 }}
                        >
                            Entendido
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function InstallIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}

function ShareIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007aff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle' }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M12 2v10" />
            <path d="m14 4-2-2-2 2" />
        </svg>
    );
}
