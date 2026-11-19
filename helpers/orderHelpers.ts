import { OrderStatus, OrderType } from '@/types';

export const getStatusLabel = (status: OrderStatus, type: OrderType): string => {
    switch (status) {
        case 'en_preparacion':
            return 'En preparación'; // Status 1
        case 'confirmado':
            return type === 'retiro_sede' ? 'Confirmado' : 'Confirmado'; // Status 2 (Retiro)
        case 'listo_para_retiro':
            return 'Listo para retiro';
        case 'en_camino':
            return 'Despachado'; // Status 2 (Delivery)
        case 'entregado':
            return 'Entregado'; // Status 3 (Delivery)
        case 'retirado':
            return 'Retirado'; // Status 3 (Retiro en sede)
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

    // Reglas de progresión canónicas según estado actual y modalidad (SEC-01):
    // retiro_sede finaliza en 'retirado'; delivery finaliza en 'entregado'.
    if (currentStatus === 'pendiente') {
        return [
            { value: 'confirmado', label: 'Confirmado' },
            { value: 'en_preparacion', label: '1. En preparación' },
            { value: 'cancelado', label: 'Cancelado' }
        ];
    }

    if (currentStatus === 'confirmado') {
        const finalStep = type === 'retiro_sede'
            ? { value: 'retirado' as OrderStatus, label: '3. Entregado' }
            : { value: 'entregado' as OrderStatus, label: '3. Entregado' };
        const midStep = type === 'retiro_sede'
            ? { value: 'listo_para_retiro' as OrderStatus, label: '2. Listo para retiro' }
            : { value: 'en_camino' as OrderStatus, label: '2. Despachado' };
        return [
            { value: 'en_preparacion', label: '1. En preparación' },
            midStep,
            finalStep,
            { value: 'cancelado', label: 'Cancelado' }
        ];
    }

    if (currentStatus === 'en_preparacion') {
        const nextStep = type === 'retiro_sede'
            ? { value: 'listo_para_retiro' as OrderStatus, label: '2. Listo para retiro' }
            : { value: 'en_camino' as OrderStatus, label: '2. Despachado' };
        return [
            nextStep,
            { value: 'cancelado', label: 'Cancelado' }
        ];
    }

    if (currentStatus === 'listo_para_retiro') {
        const nextStep = type === 'retiro_sede'
            ? { value: 'retirado' as OrderStatus, label: '3. Entregado' }
            : { value: 'en_camino' as OrderStatus, label: '2. Despachado' };
        return [
            nextStep,
            { value: 'cancelado', label: 'Cancelado' }
        ];
    }

    if (currentStatus === 'en_camino') {
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
        options.push({ value: 'confirmado', label: 'Confirmado' });
        options.push({ value: 'listo_para_retiro', label: '2. Listo para retiro' });
        options.push({ value: 'retirado', label: '3. Retirado' });
    } else {
        options.push({ value: 'en_camino', label: '2. Despachado' });
        options.push({ value: 'entregado', label: '3. Entregado' });
    }

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

export const getQuickDeliveryTarget = (type: OrderType, currentStatus: OrderStatus): 'retirado' | 'entregado' | null => {
    if (isFinalStatus(currentStatus)) return null;
    const expectedTarget: 'retirado' | 'entregado' = type === 'retiro_sede' ? 'retirado' : 'entregado';
    const allowed = getNextStatusOptions(type, currentStatus);
    return allowed.some(opt => opt.value === expectedTarget) ? expectedTarget : null;
};
