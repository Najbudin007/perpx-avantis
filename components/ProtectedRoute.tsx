"use client"

import { useAuth } from '@/lib/auth/AuthContext'
import { useBaseMiniApp } from '@/lib/hooks/useBaseMiniApp'

interface ProtectedRouteProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps): JSX.Element | null {
  const { isAuthenticated, isLoading } = useAuth()
  const { isBaseContext, isReady, auth } = useBaseMiniApp()

  // Show loading state
  if (isLoading) {
    return (
      (fallback as JSX.Element) || (
        <div className="min-h-screen bg-[#0d0d0d] flex flex-col items-center justify-center px-6 relative overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-80 h-80 rounded-full bg-gradient-to-br from-[#8759ff]/20 to-[#2c2146]/30 blur-xl animate-pulse"></div>
          </div>
          <div className="relative z-10 flex flex-col items-center text-center space-y-8">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#8759ff] to-[#A855F7] flex items-center justify-center animate-spin">
                <div className="w-8 h-8 bg-white rounded-sm"></div>
              </div>
              <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-[#8759ff]/30 animate-ping"></div>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#8759ff] to-[#A855F7] bg-clip-text text-transparent">
                PrepX AI
              </h1>
              <p className="text-[#b4b4b4] text-sm animate-pulse">Authenticating...</p>
            </div>
          </div>
        </div>
      )
    )
  }

  // If not in Base context (and SDK is ready), show error
  if (isReady && !isBaseContext) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex flex-col items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-white">Base App Required</h1>
          <p className="text-gray-400">
            This app is designed to run in the Base app. Please launch it from Base to continue.
          </p>
        </div>
      </div>
    )
  }

  // If in Base context but not authenticated yet, show loading or error
  if (isBaseContext && !isAuthenticated && !isLoading) {
    const hasAuthError = auth?.error;
    
    if (hasAuthError) {
      return (
        <div className="min-h-screen bg-[#0d0d0d] flex flex-col items-center justify-center px-6 relative overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-80 h-80 rounded-full bg-gradient-to-br from-[#8759ff]/20 to-[#2c2146]/30 blur-xl animate-pulse"></div>
          </div>
          <div className="relative z-10 flex flex-col items-center text-center space-y-8 max-w-md">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <div className="w-8 h-8 text-red-500 text-2xl">⚠️</div>
              </div>
            </div>
            <div className="space-y-4">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#8759ff] to-[#A855F7] bg-clip-text text-transparent">
                PrepX AI
              </h1>
              <p className="text-red-400 text-sm font-medium">Authentication Failed</p>
              <p className="text-[#b4b4b4] text-xs">{auth.error?.message || 'Unknown error occurred'}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-4 py-2 bg-[#8759ff] text-white rounded-lg hover:bg-[#A855F7] transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    // Still loading - give it more time
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex flex-col items-center justify-center px-6 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-80 h-80 rounded-full bg-gradient-to-br from-[#8759ff]/20 to-[#2c2146]/30 blur-xl animate-pulse"></div>
        </div>
        <div className="relative z-10 flex flex-col items-center text-center space-y-8">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#8759ff] to-[#A855F7] flex items-center justify-center animate-spin">
              <div className="w-8 h-8 bg-white rounded-sm"></div>
            </div>
            <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-[#8759ff]/30 animate-ping"></div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#8759ff] to-[#A855F7] bg-clip-text text-transparent">
              PrepX AI
            </h1>
            <p className="text-[#b4b4b4] text-sm animate-pulse">Authenticating with Base Account...</p>
            <p className="text-[#666] text-xs mt-2">This may take a few seconds</p>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
