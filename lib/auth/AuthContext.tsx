"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useBaseMiniApp } from '@/lib/hooks/useBaseMiniApp'

interface User {
  id: string
  fid: number // Farcaster ID for Base Account (0 for web users)
  webUserId?: number // Web user ID (for web users)
  baseAccountAddress: string | null // User's Base Account address or trading wallet address
  hasWallet: boolean
  createdAt: Date
}

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (token: string, userData: User) => void
  logout: () => void
  updateUser: (userData: Partial<User>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { isBaseContext, authenticate: authenticateBase, isReady: baseReady } = useBaseMiniApp()
  
  // Get web fallback setting at runtime (client-side)
  // Use a function to ensure it's evaluated at runtime, not build time
  const getIsWebFallbackEnabled = () => {
    if (typeof window !== 'undefined') {
      // Client-side: try to get from runtime config or fallback to env
      return (window as any).__RUNTIME_CONFIG__?.NEXT_PUBLIC_ENABLE_WEB_MODE !== "false" ||
             process.env.NEXT_PUBLIC_ENABLE_WEB_MODE !== "false"
    }
    // Server-side: read from process.env at runtime
    return process.env.NEXT_PUBLIC_ENABLE_WEB_MODE !== "false"
  }
  
  const isWebFallbackEnabled = getIsWebFallbackEnabled()

  const isAuthenticated = !!user

  useEffect(() => {
    // Only authenticate if in Base context
    const checkAuth = async () => {
      if (!isBaseContext) {
        if (isWebFallbackEnabled) {
          // Check for existing session in localStorage first
          if (typeof window !== 'undefined') {
            const storedToken = localStorage.getItem('web_auth_token');
            const storedUser = localStorage.getItem('web_user');

            if (storedToken && storedUser) {
              try {
                // Verify token is still valid by checking user info
                const baseUrl = window.location.origin;
                const response = await fetch(`${baseUrl}/api/auth/web`, {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${storedToken}`,
                  },
                });

                if (response.ok) {
                  const data = await response.json();
                  if (data.success && data.user) {
                    const webUser: User = {
                      id: `web_${data.user.id}`,
                      fid: 0,
                      webUserId: data.user.id,
                      baseAccountAddress: data.wallet?.address || null,
                      hasWallet: !!data.wallet,
                      createdAt: new Date(data.user.created_at),
                    };

                    setToken(storedToken);
                    setUser(webUser);
                    console.log('✅ Restored web session, User ID:', data.user.id);
                    setIsLoading(false);
                    return;
                  }
                }
              } catch (error) {
                console.error('Failed to verify stored token:', error);
                // Clear invalid session
                localStorage.removeItem('web_auth_token');
                localStorage.removeItem('web_user');
              }
            }
          }

          // No valid session found - redirect to auth page
          console.log('🌐 Web mode detected, no session found. Redirecting to auth...');
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/web')) {
            window.location.href = '/auth/web';
          }
        } else {
          console.warn('⚠️ App is not running in Base app context. Base Account is required.')
          setToken(previous => (previous === null ? previous : null))
          setUser(previous => (previous === null ? previous : null))
        }
        setIsLoading(false)
        return
      }

      // Wait for Base SDK to be ready
      if (!baseReady) {
        console.log('⏳ Waiting for Base SDK to be ready...')
        return
      }

      // Attempt to restore existing Base session from localStorage (Farcaster)
      if (typeof window !== 'undefined') {
        const storedBaseToken = localStorage.getItem('base_auth_token')
        const storedBaseUser = localStorage.getItem('base_user')
        if (storedBaseToken && storedBaseUser) {
          try {
            const parsedUser = JSON.parse(storedBaseUser) as User
            setToken(storedBaseToken)
            setUser(parsedUser)
            console.log('✅ Restored Base session from storage, FID:', parsedUser.fid)
            setIsLoading(false)
            return
          } catch (e) {
            console.warn('Failed to parse stored Base session, clearing...', e)
            localStorage.removeItem('base_auth_token')
            localStorage.removeItem('base_user')
          }
        }
      }

      try {
        console.log('🔵 Base context detected, authenticating with Base Account...')
        
        // Add timeout for authentication (35 seconds to be safe)
        const authTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Authentication timeout after 35 seconds'))
          }, 35000)
        })

        const baseAuth = await Promise.race([
          authenticateBase(),
          authTimeout
        ])
        
        if (baseAuth) {
          // Base Account authentication successful
          const baseUser: User = {
            id: `fid_${baseAuth.fid}`,
            fid: baseAuth.fid,
            baseAccountAddress: baseAuth.address || null, // User's Base Account address
            hasWallet: !!baseAuth.address, // Has wallet if we have an address
            createdAt: new Date(),
          }
          
          setToken(baseAuth.token)
          setUser(baseUser)
          if (typeof window !== 'undefined') {
            localStorage.setItem('base_auth_token', baseAuth.token || '')
            localStorage.setItem('base_user', JSON.stringify(baseUser))
          }
          console.log('✅ Base Account authentication successful, FID:', baseAuth.fid, 'Address:', baseAuth.address)
        } else {
          console.error('❌ Base Account authentication failed - authenticateBase returned null')
          // Set error state so user can see what went wrong
          setToken(null)
          setUser(null)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('❌ Auth check failed:', errorMessage)
        if (error instanceof Error) {
          console.error('Error stack:', error.stack)
        }
        // Log the error for debugging
        if (typeof window !== 'undefined') {
          console.error('Full error object:', error)
        }
        setToken(null)
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [isBaseContext, baseReady, authenticateBase, isWebFallbackEnabled])

  const login = (token: string, userData: User) => {
    console.log('🔐 Login called, setting user FID:', userData.fid)
    setToken(token)
    setUser(userData)
    if (typeof window !== 'undefined') {
      if (userData.fid && userData.fid > 0) {
        localStorage.setItem('base_auth_token', token)
        localStorage.setItem('base_user', JSON.stringify(userData))
      } else {
        localStorage.setItem('web_auth_token', token)
        localStorage.setItem('web_user', JSON.stringify(userData))
      }
    }
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    // Clear web session from localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('web_auth_token')
      localStorage.removeItem('web_user')
      localStorage.removeItem('base_auth_token')
      localStorage.removeItem('base_user')
    }
    console.log('Logged out')
  }

  const updateUser = (userData: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...userData }
      setUser(updatedUser)
    }
  }

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    isAuthenticated,
    login,
    logout,
    updateUser,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
