export const EmailService = {
    sendInviteEmail: async (to: string, inviteLink: string, socioName: string) => {
        // Feature flag for local dev: if no API key or explicitly dev, log to console.
        // In a real implementation, this would use Resend / SendGrid / etc.

        const isDev = process.env.NODE_ENV === 'development' || process.env.EMAIL_DEBUG === 'true';

        if (isDev) {
            console.log('--- EMAIL SIMULATION ---');
            console.log(`To: ${to}`);
            console.log(`Subject: Invitación a Aciacam Portal`);
            console.log(`Body: Hola ${socioName}, has sido invitado al portal de socios.`);
            console.log(`Link de activación: ${inviteLink}`);
            console.log('------------------------');
            return { success: true, simulated: true };
        }

        // Implementation for Production using Fetch or proper SDK
        // Example with Resend:
        // await resend.emails.send({ ... })

        console.warn('Email provider not configured for production yet. Logged instead.');
        return { success: false, error: 'Provider not configured' };
    },

    sendCierreEmail: async (to: string, socioName: string, periodo: string, datosCierre: any) => {
        try {
            const res = await fetch('/api/admin/cierres/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    to,
                    socioName,
                    periodo,
                    datosCierre
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to send email');
            return data;
        } catch (error: any) {
            console.error("EmailService: sendCierreEmail failed", error);
            throw error;
        }
    }
};
