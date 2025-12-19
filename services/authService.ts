import { Socio } from '@/types';
import { MOCK_SOCIOS } from './mockData';

export const AuthService = {
    // Simulate sending a code (in reality, this would API call)
    sendVerificationCode: async (contact: string): Promise<boolean> => {
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check if user exists in mock data
        const userExists = MOCK_SOCIOS.some(s => s.email === contact || s.telefono === contact);

        // For this mock, we allow anyone to "request" data, but we might check existance later.
        // Let's pretend it always succeeds for valid format.
        return true;
    },

    // Verify code and return user if successful
    verifyCode: async (contact: string, code: string): Promise<Socio | null> => {
        await new Promise((resolve) => setTimeout(resolve, 800));

        // Magic code for testing
        if (code === '123456') {
            // Find user (case insensitive and trim)
            const normalizedContact = contact.toLowerCase().trim();
            const user = MOCK_SOCIOS.find(s =>
                s.email.toLowerCase() === normalizedContact ||
                s.telefono === normalizedContact
            );

            if (!user) {
                console.warn(`Auth failed: User not found for contact "${normalizedContact}". Available: ${MOCK_SOCIOS.map(s => s.email).join(', ')}`);
            }

            return user || null;
        }
        return null;
    }
};
