"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { useAuth } from "@/lib/auth/AuthContext"
import { useBaseMiniApp } from "@/lib/hooks/useBaseMiniApp"

export default function LoadingPage() {
  const [progress, setProgress] = useState(0)
  const [loadingText, setLoadingText] = useState("Loading PrepX...")
  const router = useRouter()
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth()
  const { isBaseContext, contextChecked } = useBaseMiniApp()

  useEffect(() => {
    // Wait for auth AND Base context detection before deciding where to navigate
    if (isAuthLoading || !contextChecked) {
      return
    }

    // Ultra-fast loading - just show progress animation
    const startTime = Date.now()
    const duration = 800 // Total loading time: 800ms
    let animationFrameId: number | null = null
    let hasNavigated = false
    
    const navigate = () => {
      if (hasNavigated) return
      hasNavigated = true
      
      // Navigate based on authentication status and environment
      if (isAuthenticated) {
        // Authenticated users always go to trading home
        router.push("/home")
      } else if (contextChecked && !isBaseContext) {
        // Web mode and not authenticated - redirect to web auth page
        router.push("/auth/web")
      } else {
        // Base mini-app context (or still determining) - stay in app/root
        router.push("/")
      }
    }
    
    const updateProgress = () => {
      const elapsed = Date.now() - startTime
      const progressPercent = Math.min((elapsed / duration) * 100, 100)
      
      setProgress(progressPercent)
      
      if (progressPercent < 50) {
        setLoadingText("Loading PrepX...")
      } else if (progressPercent < 100) {
        setLoadingText("Ready to Trade!")
      }
      
      if (progressPercent < 100) {
        animationFrameId = requestAnimationFrame(updateProgress)
      } else {
        // Navigate immediately when complete
        navigate()
      }
    }
    
    updateProgress()

    // Fallback timeout to ensure navigation happens even if animation fails
    const timeoutId = setTimeout(() => {
      if (!hasNavigated) {
        setProgress(100)
        navigate()
      }
    }, duration + 100) // Slightly longer than animation duration

    // Cleanup function to cancel animation frame and timeout if component unmounts
    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      clearTimeout(timeoutId)
    }
  }, [router, isAuthenticated, isAuthLoading, isBaseContext, contextChecked])

  return (
    <div className="min-h-screen bg-[#0d0d0d] flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Background gradient circles */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-80 h-80 rounded-full bg-gradient-to-br from-[#8759ff]/20 to-[#2c2146]/30 blur-xl animate-pulse"></div>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center text-center space-y-12 max-w-sm mx-auto">
        {/* Logo/Icon */}
        <div className="relative">
          <div className="w-24 h-24 bg-[#4A2C7C] rounded-2xl flex items-center justify-center shadow-lg">
            <Image src="/trading-bot-icon.svg" alt="PrepX AI Bot" width={48} height={48} className="w-12 h-12" />
          </div>
          {/* Pulsing ring */}
          <div className="absolute inset-0 w-24 h-24 rounded-2xl border-2 border-[#8759ff]/30 animate-ping"></div>
        </div>

        {/* PrepX Title */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-[#8759ff] to-[#A855F7] bg-clip-text text-transparent">
            PrepX AI
          </h1>
          <p className="text-[#b4b4b4] text-sm">AI-Powered Trading Bot</p>
        </div>

        {/* Loading Progress */}
        <div className="w-full space-y-4">
          {/* Progress Bar */}
          <div className="w-full bg-[#1a1a1a] rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#8759ff] to-[#A855F7] rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            ></div>
          </div>

          {/* Progress Text */}
          <div className="flex justify-between items-center text-sm">
            <span className="text-[#b4b4b4] animate-pulse">{loadingText}</span>
            <span className="text-[#8759ff] font-medium">{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Loading Dots Animation */}
        <div className="flex space-x-2">
          <div className="w-2 h-2 bg-[#8759ff] rounded-full animate-bounce"></div>
          <div className="w-2 h-2 bg-[#8759ff] rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
          <div className="w-2 h-2 bg-[#8759ff] rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
        </div>
      </div>
    </div>
  )
}
