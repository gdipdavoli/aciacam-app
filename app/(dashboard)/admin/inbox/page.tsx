'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  InboxSummaryResponse,
  InboxItemDTO,
  InboxDetailDTO,
  InboxCategoryFilter,
  InboxPriorityFilter,
  ActionType,
  AuditActionType,
  ProposalActionType,
  CommunicationActionType,
} from '@/types/inbox';
import {
  fetchInboxSummary,
  fetchInboxPage,
  fetchInboxDetail,
  executeAuditFindingAction,
  executeProfileProposalAction,
  executeCommunicationAction,
} from '@/app/lib/inbox-client';
import { InboxHeader } from '@/app/components/admin/inbox/InboxHeader';
import { InboxSummaryCards } from '@/app/components/admin/inbox/InboxSummaryCards';
import { InboxFilters } from '@/app/components/admin/inbox/InboxFilters';
import { InboxList } from '@/app/components/admin/inbox/InboxList';
import { InboxDetailDrawer } from '@/app/components/admin/inbox/InboxDetailDrawer';
import { InboxActionDialog } from '@/app/components/admin/inbox/InboxActionDialog';
import { ShieldAlert } from 'lucide-react';

export default function AdminInboxPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect non-admin/staff users
  useEffect(() => {
    if (!authLoading && user && user.rol === 'socio') {
      router.replace('/cuenta');
    }
  }, [user, authLoading, router]);

  // State
  const [summary, setSummary] = useState<InboxSummaryResponse | null>(null);
  const [items, setItems] = useState<InboxItemDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<InboxCategoryFilter>('ALL');
  const [selectedPriority, setSelectedPriority] = useState<InboxPriorityFilter>('ALL');

  // Loading states
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Detail Drawer state
  const [selectedItemSummary, setSelectedItemSummary] = useState<InboxItemDTO | null>(null);
  const [detailData, setDetailData] = useState<InboxDetailDTO | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // Action Dialog state
  const [actionState, setActionState] = useState<{
    isOpen: boolean;
    actionType: ActionType | null;
    targetItem: InboxItemDTO | null;
    isExecuting: boolean;
  }>({
    isOpen: false,
    actionType: null,
    targetItem: null,
    isExecuting: false,
  });

  // Fetch summary
  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchInboxSummary();
      setSummary(res);
    } catch (err: unknown) {
      console.error('Error fetching inbox summary:', err);
    }
  }, []);

  // Fetch initial page of items
  const loadInitialItems = useCallback(async (category: InboxCategoryFilter, priority: InboxPriorityFilter) => {
    setLoadingInitial(true);
    try {
      const pageRes = await fetchInboxPage({
        category,
        priority,
        limit: 20,
      });
      setItems(pageRes.items);
      setNextCursor(pageRes.next_cursor || null);
      setHasMore(pageRes.has_more);
    } catch (err: unknown) {
      console.error('Error fetching inbox items:', err);
      toast.error('No se pudo cargar el listado de la bandeja.');
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  // Fetch next page
  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const pageRes = await fetchInboxPage({
        category: selectedCategory,
        priority: selectedPriority,
        limit: 20,
        cursor: nextCursor,
      });

      // Deduplicate items upon concatenation
      setItems((prev) => {
        const existingKeys = new Set(prev.map((i) => `${i.source_type}:${i.source_id}`));
        const newUnique = pageRes.items.filter((i) => !existingKeys.has(`${i.source_type}:${i.source_id}`));
        return [...prev, ...newUnique];
      });

      setNextCursor(pageRes.next_cursor || null);
      setHasMore(pageRes.has_more);
    } catch (err: unknown) {
      console.error('Error fetching more inbox items:', err);
      toast.error('Error al cargar más elementos.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Manual Refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadSummary(), loadInitialItems(selectedCategory, selectedPriority)]);
    setIsRefreshing(false);
    toast.success('Bandeja actualizada.');
  };

  // Initial load
  useEffect(() => {
    if (user && (user.rol === 'admin' || user.rol === 'staff')) {
      loadSummary();
      loadInitialItems(selectedCategory, selectedPriority);
    }
  }, [user, loadSummary, loadInitialItems]);

  // Handle filter changes (resets pagination and items)
  const handleCategoryChange = (cat: InboxCategoryFilter) => {
    setSelectedCategory(cat);
    loadInitialItems(cat, selectedPriority);
  };

  const handlePriorityChange = (prio: InboxPriorityFilter) => {
    setSelectedPriority(prio);
    loadInitialItems(selectedCategory, prio);
  };

  // Select Item for Detail Drawer
  const handleSelectItem = async (item: InboxItemDTO) => {
    setSelectedItemSummary(item);
    setDetailData(null);
    setLoadingDetail(true);

    try {
      const detail = await fetchInboxDetail(item.source_type, item.source_id);
      setDetailData(detail);
    } catch (err: unknown) {
      console.error('Error fetching item detail:', err);
      toast.error('No se pudo cargar el detalle del elemento.');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Close Detail Drawer
  const handleCloseDetail = () => {
    setSelectedItemSummary(null);
    setDetailData(null);
  };

  // Open Action Dialog from Detail
  const handleOpenAction = (actionType: ActionType) => {
    if (!selectedItemSummary) return;
    setActionState({
      isOpen: true,
      actionType,
      targetItem: selectedItemSummary,
      isExecuting: false,
    });
  };

  // Confirm Action Execution
  const handleConfirmAction = async (note?: string) => {
    const { actionType, targetItem } = actionState;
    if (!actionType || !targetItem) return;

    setActionState((prev) => ({ ...prev, isExecuting: true }));

    try {
      if (targetItem.source_type === 'audit_findings' || targetItem.source_type === 'audit_finding') {
        await executeAuditFindingAction(targetItem.source_id, actionType as AuditActionType, note);
      } else if (targetItem.source_type === 'profile_update_proposals' || targetItem.source_type === 'profile_proposal') {
        await executeProfileProposalAction(targetItem.source_id, actionType as ProposalActionType, note);
      } else if (targetItem.source_type === 'communication_intents' || targetItem.source_type === 'communication_intent') {
        await executeCommunicationAction(targetItem.source_id, actionType as CommunicationActionType, note);
      }

      toast.success('Acción ejecutada correctamente.');
      
      // Close dialog & drawer
      setActionState({ isOpen: false, actionType: null, targetItem: null, isExecuting: false });
      handleCloseDetail();

      // Refresh list & summary
      loadSummary();
      loadInitialItems(selectedCategory, selectedPriority);
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      setActionState((prev) => ({ ...prev, isExecuting: false }));

      if (apiErr?.status === 409) {
        toast.warning('Este elemento fue modificado por otra operación. Actualizamos la bandeja.');
        setActionState({ isOpen: false, actionType: null, targetItem: null, isExecuting: false });
        handleCloseDetail();
        loadSummary();
        loadInitialItems(selectedCategory, selectedPriority);
      } else if (apiErr?.status === 403) {
        toast.error('No tiene permisos para realizar esta acción.');
      } else if (apiErr?.status === 422) {
        toast.error(apiErr?.message || 'Error de validación al procesar la solicitud.');
      } else {
        toast.error(apiErr?.message || 'Ocurrió un error inesperado al procesar la acción.');
      }
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!user || user.rol === 'socio') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShieldAlert className="h-12 w-12 text-rose-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Acceso restringido</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          La Bandeja Administrativa está disponible únicamente para personal autorizado.
        </p>
      </div>
    );
  }

  const isStaff = user.rol === 'staff';

  // Compute dialog properties based on action type
  const getDialogProps = () => {
    const action = actionState.actionType;
    if (!action) {
      return {
        title: 'Confirmar acción',
        description: '¿Desea confirmar esta acción?',
        confirmLabel: 'Confirmar',
        confirmVariant: 'primary' as const,
        requiresNote: false,
        noteMinLength: 0,
      };
    }

    switch (action) {
      case 'in_review':
        return {
          title: 'Marcar en revisión',
          description: 'Esta acción cambiará el estado del hallazgo a "En revisión" para indicar que se está analizando.',
          confirmLabel: 'Marcar en revisión',
          confirmVariant: 'primary' as const,
          requiresNote: false,
          noteMinLength: 0,
        };
      case 'resolve':
        return {
          title: 'Resolver hallazgo',
          description: 'Esta acción registra la revisión del hallazgo. No modifica automáticamente los datos relacionados.',
          confirmLabel: 'Resolver',
          confirmVariant: 'success' as const,
          requiresNote: true,
          noteMinLength: 3,
        };
      case 'dismiss':
        return {
          title: 'Descartar hallazgo',
          description: 'Esta acción descarta el hallazgo de auditoría. Se registrará la decisión administrativa.',
          confirmLabel: 'Descartar',
          confirmVariant: 'destructive' as const,
          requiresNote: false,
          noteMinLength: 0,
        };
      case 'approve':
        return {
          title: 'Aprobar elemento',
          description: 'Aprobar registra la decisión de revisión. No modifica todavía de forma automática datos ni realiza envíos.',
          confirmLabel: 'Aprobar',
          confirmVariant: 'success' as const,
          requiresNote: false,
          noteMinLength: 0,
        };
      case 'reject':
        return {
          title: 'Rechazar propuesta',
          description: 'Esta acción rechaza la propuesta de actualización de perfil.',
          confirmLabel: 'Rechazar',
          confirmVariant: 'destructive' as const,
          requiresNote: false,
          noteMinLength: 0,
        };
      case 'cancel':
        return {
          title: 'Cancelar elemento',
          description: 'Esta acción cancela el registro administrativo.',
          confirmLabel: 'Cancelar',
          confirmVariant: 'destructive' as const,
          requiresNote: false,
          noteMinLength: 0,
        };
      default:
        return {
          title: 'Confirmar acción',
          description: '¿Está seguro de continuar?',
          confirmLabel: 'Confirmar',
          confirmVariant: 'primary' as const,
          requiresNote: false,
          noteMinLength: 0,
        };
    }
  };

  const dialogProps = getDialogProps();

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <InboxHeader onRefresh={handleRefresh} isRefreshing={isRefreshing} />

      {/* Summary Cards */}
      <InboxSummaryCards
        summary={summary}
        selectedCategory={selectedCategory}
        onSelectCategory={handleCategoryChange}
        userRole={user.rol}
      />

      {/* Filters */}
      <InboxFilters
        selectedCategory={selectedCategory}
        selectedPriority={selectedPriority}
        onSelectCategory={handleCategoryChange}
        onSelectPriority={handlePriorityChange}
        userRole={user.rol}
      />

      {/* Item List */}
      <InboxList
        items={items}
        selectedItem={selectedItemSummary}
        loadingInitial={loadingInitial}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        onSelectItem={handleSelectItem}
      />

      {/* Detail Drawer */}
      <InboxDetailDrawer
        item={selectedItemSummary}
        userRole={user.rol}
        onClose={handleCloseDetail}
        onRequestAction={(action) => handleOpenAction(action as ActionType)}
      />

      {/* Action Dialog */}
      <InboxActionDialog
        isOpen={actionState.isOpen}
        onClose={() => setActionState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmAction}
        title={dialogProps.title}
        description={dialogProps.description}
        confirmLabel={dialogProps.confirmLabel}
        confirmVariant={dialogProps.confirmVariant}
        requiresNote={dialogProps.requiresNote}
        noteMinLength={dialogProps.noteMinLength}
      />
    </div>
  );
}
