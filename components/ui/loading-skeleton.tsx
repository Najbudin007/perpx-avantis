import React from 'react'

interface LoadingSkeletonProps {
  className?: string
  lines?: number
}

export function LoadingSkeleton({ className = '', lines = 1 }: LoadingSkeletonProps) {
  return (
    <div className={`animate-pulse ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="h-4 bg-gray-700 rounded mb-2"
          style={{
            width: `${Math.random() * 40 + 60}%`,
            animationDelay: `${index * 0.1}s`
          }}
        />
      ))}
    </div>
  )
}

// Position row skeleton - more detailed and interactive
export function PositionSkeleton() {
  return (
    <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-700 rounded-full"></div>
          <div>
            <div className="h-4 bg-gray-700 rounded w-20 mb-2"></div>
            <div className="h-3 bg-gray-700 rounded w-16"></div>
          </div>
        </div>
        <div className="text-right">
          <div className="h-5 bg-gray-700 rounded w-24 mb-2"></div>
          <div className="h-3 bg-gray-700 rounded w-16 ml-auto"></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>
          <div className="h-3 bg-gray-700 rounded w-16 mb-2"></div>
          <div className="h-4 bg-gray-700 rounded w-20"></div>
        </div>
        <div>
          <div className="h-3 bg-gray-700 rounded w-16 mb-2"></div>
          <div className="h-4 bg-gray-700 rounded w-20"></div>
        </div>
      </div>
    </div>
  )
}

// Trade history row skeleton
export function TradeSkeleton() {
  return (
    <div className="bg-[#2a2a2a] border border-[#374151] rounded-lg p-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-700 rounded"></div>
          <div>
            <div className="h-4 bg-gray-700 rounded w-24 mb-2"></div>
            <div className="h-3 bg-gray-700 rounded w-32"></div>
          </div>
        </div>
        <div className="text-right">
          <div className="h-4 bg-gray-700 rounded w-20 mb-2"></div>
          <div className="h-3 bg-gray-700 rounded w-16 ml-auto"></div>
        </div>
      </div>
    </div>
  )
}

// Loading state with spinner and message
export function LoadingState({ message = 'Loading...', showSpinner = true }: { message?: string; showSpinner?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      {showSpinner && (
        <div className="relative w-12 h-12 mb-4">
          <div className="absolute inset-0 border-4 border-[#8759ff]/20 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-transparent border-t-[#8759ff] rounded-full animate-spin"></div>
        </div>
      )}
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  )
}

// Refresh indicator - shows when data is being updated
export function RefreshIndicator({ isRefreshing, message }: { isRefreshing: boolean; message?: string }) {
  if (!isRefreshing) return null
  
  return (
    <div className="flex items-center gap-2 text-[#8759ff] text-xs py-2 px-3 bg-[#8759ff]/10 rounded-lg mb-4">
      <div className="w-3 h-3 border-2 border-[#8759ff] border-t-transparent rounded-full animate-spin"></div>
      <span>{message || 'Refreshing data...'}</span>
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="bg-[#1a1a1a] border-[#262626] p-6 rounded-2xl animate-pulse">
      <div className="space-y-4">
        <div className="h-6 bg-gray-700 rounded w-3/4"></div>
        <div className="space-y-2">
          <div className="h-4 bg-gray-700 rounded w-full"></div>
          <div className="h-4 bg-gray-700 rounded w-5/6"></div>
          <div className="h-4 bg-gray-700 rounded w-4/6"></div>
        </div>
      </div>
    </div>
  )
}

export function BalanceSkeleton() {
  return (
    <div className="bg-[#1a1a1a] border-[#262626] p-6 rounded-2xl animate-pulse">
      <div className="space-y-4">
        <div className="h-4 bg-gray-700 rounded w-1/3"></div>
        <div className="h-12 bg-gray-700 rounded w-2/3"></div>
        <div className="flex space-x-4">
          <div className="h-4 bg-gray-700 rounded w-1/4"></div>
          <div className="h-4 bg-gray-700 rounded w-1/6"></div>
        </div>
      </div>
    </div>
  )
}
