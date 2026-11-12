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

export const getNextStatusOptions = (type: OrderType, currentStatus?: OrderStatus): { value: OrderStatus, label: string }[] => {
    // Si el pedido ya se encuentra en un estado terminal, no se admiten transiciones
    if (currentStatus && isFinalStatus(currentStatus)) {
        return [];
    }

    // Reglas de progresión según estado actual:
    // pendiente -> en_preparacion | cancelado
    // en_preparacion -> confirmado (retiro) / en_camino (delivery) | cancelado
    // confirmado / en_camino -> entregado | cancelado
    if (currentStatus === 'pendiente') {
        return [
            { value: 'en_preparacion', label: '1. En preparación' },
            { value: 'cancelado', label: 'Cancelado' }
        ];
    }

    if (currentStatus === 'en_preparacion') {
        const nextStep = type === 'retiro_sede'
            ? { value: 'confirmado' as OrderStatus, label: '2. Confirmado (Para Retirar)' }
            : { value: 'en_camino' as OrderStatus, label: '2. Despachado' };
        return [
            nextStep,
            { value: 'cancelado', label: 'Cancelado' }
        ];
    }

    if (currentStatus === 'confirmado' || currentStatus === 'en_camino') {
        return [
            { value: 'entregado', label: '3. Entregado' },
            { value: 'cancelado', label: 'Cancelado' }
        ];
    }

    // Fallback retrocompatible si no se especificó currentStatus
    const options: { value: OrderStatus, label: string }[] = [
        { value: 'en_preparacion', label: '1. En preparación' },
    ];

    if (type === 'retiro_sede') {
        options.push({ value: 'confirmado', label: '2. Confirmado (Para Retirar)' });
    } else {
        options.push({ value: 'en_camino', label: '2. Despachado' });
    }

    options.push({ value: 'entregado', label: '3. Entregado' });
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
