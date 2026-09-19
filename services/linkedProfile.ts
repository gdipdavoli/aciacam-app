/** Only a confirmed 404 means the authenticated account has no linked member. */
export async function fetchLinkedProfile(userId: string, request: typeof fetch = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await request(`/api/admin/socios/by-user?id=${encodeURIComponent(userId)}`, {
            credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error('No pudimos verificar tu ficha. Volvé a intentarlo.');
        const profile = await response.json();
        if (!profile?.id) throw new Error('La respuesta de la ficha está incompleta.');
        return profile;
    } catch (error) {
        if (controller.signal.aborted) throw new Error('La conexión está tardando. Volvé a intentarlo.');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
