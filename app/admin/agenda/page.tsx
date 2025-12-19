
import AgendaManager from '@/app/components/admin/AgendaManager';

export default function AdminAgendaPage() {
    return (
        <div className="p-6">
            <div className="mb-6">
                <a href="/admin" className="text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors">
                    <span>←</span> Volver al Panel
                </a>
            </div>
            <h1 className="text-3xl font-bold mb-6 text-foreground">Administración de Agenda</h1>
            <p className="text-muted-foreground mb-8 max-w-2xl">
                Configure aquí los horarios habituales de retiro de pedidos y genere los turnos disponibles para los socios.
            </p>

            <AgendaManager />
        </div>
    );
}
