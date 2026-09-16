'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { ChatContainer } from '@/app/components/admin/chat/ChatContainer';

export default function AdminAsistentePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.rol !== 'admin' && user.rol !== 'staff') {
      router.replace('/cuenta');
    }
  }, [user, loading, router]);

  if (loading || !user || (user.rol !== 'admin' && user.rol !== 'staff')) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-6rem)]">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <ChatContainer userRole={user.rol} />
    </div>
  );
}
