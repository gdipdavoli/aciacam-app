import { OrderStatus, OrderType } from '@/types';

export const getStatusLabel = (status: OrderStatus, type: OrderType): string => {
    switch (status) {
        case 'en_preparacion':
            return 'En preparación'; // Status 1
        case 'confirmado':
            return type === 'retiro_sede' ? 'Confirmado' : 'Confirmado'; // Status 2 (Retiro)
        case 'en_camino':
            return 'Despachado'; // Status 2 (Delivery)
        case 'entregado':
        case 'retirado':
            return 'Entregado'; // Status 3
        case 'pendiente':
            return 'Pendiente';
        case 'cancelado':
            return 'Cancelado';
        default:
            return status;
    }
};

export const getNextStatusOptions = (type: OrderType): { value: OrderStatus, label: string }[] => {
    // Rules:
    // 1 -> En preparación
    // 2 -> Confirmado (Retiro) / Despachado (Delivery)
    // 3 -> Entregado

    const options: { value: OrderStatus, label: string }[] = [
        { value: 'en_preparacion', label: '1. En preparación' },
    ];

    if (type === 'retiro_sede') {
        options.push({ value: 'confirmado', label: '2. Confirmado (Para Retirar)' });
    } else {
        options.push({ value: 'en_camino', label: '2. Despachado' });
    }

    // Unify 3 as 'entregado' for simplicity in filtering, 
    // or keep 'retirado' if backend needs specific distinction.
    // User requested "Status 3 => Entregado" label.
    // Let's use 'entregado' as the canonical final state for now, 
    // or map 'retirado' to have 'Entregado' label.
    options.push({ value: 'entregado', label: '3. Entregado' });

    // Legacy/Extra options can be appended or kept separate
    options.push({ value: 'cancelado', label: 'Cancelado' });
    options.push({ value: 'pendiente', label: 'Pendiente (Inicial)' });

    return options;
};

export const isFinalStatus = (status: OrderStatus): boolean => {
    return status === 'entregado' || status === 'retirado' || status === 'cancelado';
};

export const shouldShowInDefaultList = (status: OrderStatus): boolean => {
    // Hide 'entregado' (3) and 'retirado' by default.
    // Show 1 and 2.
    return status !== 'entregado' && status !== 'retirado' && status !== 'cancelado';
};
