"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useAuth } from "@/lib/auth/AuthContext"
import { useBaseMiniApp } from "@/lib/hooks/useBaseMiniApp"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function WelcomePage() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()
  const { isBaseContext, contextChecked } = useBaseMiniApp()

  useEffect(() => {
    // Wait until we know whether we're in Base context to avoid
    // accidentally redirecting mini-app users to the web auth page
    if (!isLoading && contextChecked) {
      if (isAuthenticated) {
        // User is authenticated, go to home
        router.push('/home')
      } else if (!isBaseContext) {
        // Web mode and not authenticated - redirect to auth page
        router.push('/auth/web')
      } else if (isBaseContext && !isAuthenticated) {
        // Base context but not authenticated - wait for Base auth
      }
    }
  }, [isAuthenticated, isLoading, isBaseContext, contextChecked, router])
  // Show loading while authenticating
  if (isLoading) {
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
            <p className="text-[#b4b4b4] text-sm animate-pulse">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  // If not in Base context and not authenticated, redirect will happen in useEffect
  if (contextChecked && !isBaseContext && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex flex-col items-center justify-center px-6">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-white">Redirecting to login...</h1>
          <p className="text-gray-400">Please authenticate to continue</p>
        </div>
      </div>
    )
  }

  // Show loading while waiting for redirect
  return (
    <div className="min-h-screen bg-[#0d0d0d] flex flex-col items-center justify-center px-6">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-white">Redirecting...</h1>
        <p className="text-gray-400">Preparing your dashboard</p>
      </div>
    </div>
  )
}
