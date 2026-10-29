import { isOutboundCommsBlocked, logCommsSimulation, maskRecipient } from '@/app/lib/comms-guard';

export const EmailService = {
    sendInviteEmail: async (to: string, inviteLink: string, socioName: string) => {
        const isBlocked = isOutboundCommsBlocked();
        const isDev = process.env.NODE_ENV === 'development' || process.env.EMAIL_DEBUG === 'true';

        if (isBlocked || isDev) {
            logCommsSimulation({
                channel: 'email',
                recipient: to,
                action: 'invite_email_simulated',
                subjectOrType: 'Invitación a Aciacam Portal'
            });
            return { success: true, simulated: true, recipient: maskRecipient(to) };
        }

        // Implementation for Production using Fetch or proper SDK
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
                    cierreId: datosCierre.id
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
