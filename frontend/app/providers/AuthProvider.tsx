'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/services/firebaseAuth.service';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAuthenticated: false,
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let isMounted = true;
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (isMounted) {
        setUser(currentUser);
        setLoading(false);
        
        // Update authentication status
        const hasGuestUser = typeof window !== 'undefined' ? localStorage.getItem('guestUser') : null;
        setIsAuthenticated(Boolean(currentUser || hasGuestUser));
      }
    });

    // Check for guest user in localStorage (only on client side)
    if (typeof window !== 'undefined' && !user && !loading) {
      const guestData = localStorage.getItem('guestUser');
      if (guestData) {
        try {
          const guestUser = JSON.parse(guestData);
          setUser(guestUser);
          setIsAuthenticated(true);
        } catch (error) {
          console.error('Error parsing guest user data:', error);
          localStorage.removeItem('guestUser');
        }
      }
    }

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [user, loading]);

  // Update authentication status when user changes
  useEffect(() => {
    const hasGuestUser = typeof window !== 'undefined' ? localStorage.getItem('guestUser') : null;
    setIsAuthenticated(Boolean(user || hasGuestUser));
  }, [user]);

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        loading, 
        isAuthenticated 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
} 