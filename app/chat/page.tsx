"use client"
import { Card } from "@/components/ui/card"
import type React from "react"
import Image from "next/image"

import { Button } from "@/components/ui/button"
import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { useTradingSession } from "@/lib/hooks/useTradingSession"
import { usePositions } from "@/lib/hooks/usePositions"
import { useIntegratedWallet } from "@/lib/wallet/IntegratedWalletContext"
import { useSearchParams } from "next/navigation"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { getStorageItem } from "@/lib/utils/safeStorage"
import { QuickActions } from "@/components/ui/quick-actions"
import { useToast } from "@/components/ui/toast"
import { EmptyState } from "@/components/ui/empty-state"
import { CardSkeleton } from "@/components/ui/loading-skeleton"
import { ProgressIndicator } from "@/components/ui/progress-indicator"

export default function ChatPage() {
  const searchParams = useSearchParams()
  const hasStartedTradingRef = useRef(false) // Prevent duplicate trading starts
  const [expandedSections, setExpandedSections] = useState<string[]>([])
  const [tradingPhase, setTradingPhase] = useState<"initial" | "active" | "closing" | "completed" | "conversation">(
    "conversation",
  )
  const [closingPositions, setClosingPositions] = useState<string[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isTerminalExpanded, setIsTerminalExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [terminalPosition, setTerminalPosition] = useState({ right: 16, bottom: 80 }) // Default: right: 16px, bottom: 80px
  const [messages, setMessages] = useState<Array<{type: "user" | "bot", content: string, timestamp: string}>>([])
  const [showTyping, setShowTyping] = useState(false)
  const [hasDragged, setHasDragged] = useState(false)
  const [dragStartPosition, setDragStartPosition] = useState({ x: 0, y: 0 })
  const [showTradingGoals, setShowTradingGoals] = useState(false)
  const [showTradingAnalysis, setShowTradingAnalysis] = useState(false)
  const [targetProfit, setTargetProfit] = useState<string>("10")
  const [investmentAmount, setInvestmentAmount] = useState<string>("50")
  const [showLiveCard, setShowLiveCard] = useState(true)

  // Trading integration
  const {
    tradingSession,
    startTrading,
    stopTrading,
    refreshSessionStatus,
    clearSession,
  } = useTradingSession()
  const { addToast } = useToast()

  // Real-time position data
  const {
    positionData,
    isLoading: positionsLoading,
    fetchPositions,
    closePosition: closeIndividualPosition,
    closeAllPositions: closeAllPositionsHook,
  } = usePositions()
  
  // 🛑 STABILIZE: Use ref to avoid function dependency in callbacks
  const fetchPositionsRef = useRef(fetchPositions);
  useEffect(() => {
    fetchPositionsRef.current = fetchPositions;
  }, [fetchPositions]);

  // Wallet integration
  const {
    isConnected,
    totalPortfolioValue,
    avantisBalance,
  } = useIntegratedWallet()

  // Update trading phase based on session status
  useEffect(() => {
    if (tradingSession?.status === 'running') {
      setTradingPhase('active')
    } else if (tradingSession?.status === 'completed') {
      setTradingPhase('completed')
    } else if (tradingSession?.status === 'stopped') {
      setTradingPhase('completed')
      // Hide the live card when session is stopped
      setShowLiveCard(false)
      // Clear the trading session after a delay to show final results
      setTimeout(() => {
        clearSession()
      }, 5000) // Clear after 5 seconds to show final PnL
    }
  }, [tradingSession])

  useEffect(() => {
    if (!tradingSession) {
      setTradingPhase('initial')
    } else {
      // Only refresh if we have a session and it's running
      // Don't refresh on every render to prevent flickering
      if (tradingSession.status === 'running') {
        refreshSessionStatus().catch(() => {
          // Silently handle errors to prevent flickering
        })
      }
    }
  }, [tradingSession?.id]) // Only depend on session ID, not the entire session object

  // Auto-start trading if parameters are provided
  useEffect(() => {
    const profit = searchParams.get('profit')
    const investment = searchParams.get('investment')
    const mode = searchParams.get('mode')
    const lossThreshold = searchParams.get('lossThreshold')
    const maxPositions = searchParams.get('maxPositions')
    const view = searchParams.get('view') // 'positions' for viewing existing trades
    
    // Handle view=positions case (viewing existing trades)
    if (view === 'positions' && mode === 'real') {
      setTradingPhase('active')
      setMessages([{
        type: "bot",
        content: `📊 **Live Trading Dashboard**\n\nYou have active positions running on Avantis. Here's your current trading status:`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }])
      return
    }

    if (profit && investment && !tradingSession && !hasStartedTradingRef.current) {
      hasStartedTradingRef.current = true // Prevent multiple starts
      const profitNum = parseInt(profit)
      const investmentNum = parseInt(investment)
      
      // Only real trading mode - require wallet connection
      if (!isConnected) {
        setMessages([{
          type: "bot",
          content: "❌ **Wallet Required**\n\nPlease connect your wallet first to start trading. Real trading requires a connected wallet with funds.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }])
        return
      }
      
      // Real trading mode - check wallet requirements
      if (totalPortfolioValue === 0) {
        setMessages([{
          type: "bot",
          content: "❌ Your wallet balance is $0. Please add funds to your wallet before starting real trading.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }])
        return
      }
      
      // Check minimum Avantis balance requirement ($10)
      if (avantisBalance < 10) {
        setMessages([{
          type: "bot",
          content: `⚠️ **Insufficient Balance**\n\nYour current Avantis trading balance is **$${avantisBalance.toFixed(2)}**. The minimum required balance to start trading is **$10.00**.\n\n**Please deposit at least $${(10 - avantisBalance).toFixed(2)} more** to your Avantis trading vault before starting a trading session.\n\n💡 You can deposit funds from the Home page using your Base wallet.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }])
        return
      }
      
      // Check if investment amount exceeds available balance
      if (investmentNum > avantisBalance) {
        setMessages([{
          type: "bot",
          content: `⚠️ **Investment Amount Exceeds Balance**\n\nYou're trying to invest **$${investmentNum}** but your Avantis balance is only **$${avantisBalance.toFixed(2)}**.\n\n**Please either:**\n• Reduce your investment amount to $${avantisBalance.toFixed(2)} or less\n• Deposit more funds to your Avantis trading vault\n\n💡 You can deposit funds from the Home page.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }])
        return
      }
      
      // Start real trading with progress updates
      const progressMessageId = Date.now().toString();
      setMessages([{
        type: "bot",
        content: `💰 **Starting REAL TRADING**\n\n📊 Investment: $${investmentNum}\n🎯 Target Profit: $${profitNum}\n\n⏳ **Initializing...**\n\n🔄 Starting trading session...`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }])
      
      let successMessageAdded = false; // Prevent duplicate messages
      
      startTrading({
          profitGoal: profitNum,
          maxBudget: investmentNum,
          maxPerSession: maxPositions ? parseInt(maxPositions) : 1,
          lossThreshold: lossThreshold ? parseFloat(lossThreshold) : 10
      }, (step, message) => {
        // Show toast for session start
        if (step === 'session' && message.includes('✅')) {
          addToast({
            type: 'success',
            title: 'Trading session started!',
            message: 'Monitoring markets and executing trades',
          })
        }
        // Update progress in real-time
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage.type === "bot") {
            let content = lastMessage.content;
            
            // Update the relevant step (fee step is skipped now)
            if (step === 'session') {
              content = content.replace(/🔄 Starting trading session\.\.\./, `✅ ${message}`);
              // Only add the active message if not already present
              if (!content.includes('🚀 **Trading session is now active!**')) {
                content += `\n\n🚀 **Trading session is now active!**\n\n📈 Monitoring markets and executing trades on Avantis...`;
              }
            } else if (step === 'complete') {
              content = content.replace(/🔄.*/, '');
              content += `\n\n${message}`;
            }
            
            return [...prev.slice(0, -1), { ...lastMessage, content }];
          }
          return prev;
        });
      }).then(() => {
        // Only add success message once (check if it already exists)
        setMessages(prev => {
          const hasSuccessMessage = prev.some(msg => 
            msg.type === "bot" && 
            msg.content.includes("Trading session started successfully")
          );
          
          if (!hasSuccessMessage) {
            return [...prev, {
              type: "bot",
              content: `✅ **Trading session started successfully!**\n\n📊 The bot is now actively monitoring markets and will open positions on Avantis when profitable opportunities are detected.\n\n💡 Positions will appear in your Avantis dashboard when opened.\n\n💡 You can monitor your positions and PnL in real-time above.`,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            }];
          }
          return prev;
        });
      }).catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Determine the appropriate error message based on error type
        let userFriendlyMessage = '';
        
        if (errorMessage.includes('Trading engine is not accessible') || 
            errorMessage.includes('Failed to connect to trading engine') ||
            errorMessage.includes('ECONNREFUSED') ||
            errorMessage.includes('fetch failed')) {
          userFriendlyMessage = '🔌 **Trading Engine Connection Error**\n\nThe trading engine service is not accessible. This is a server connectivity issue, not a problem with your balance or wallet.\n\n**Possible causes:**\n• Trading engine service is not running\n• Network connectivity issues\n• Server configuration problem\n\nPlease contact support or try again later.';
        } else if (errorMessage.includes('Trading engine request timed out') || 
                   errorMessage.includes('timeout') || 
                   errorMessage.includes('AbortError')) {
          userFriendlyMessage = '⏱️ **Request Timeout**\n\nThe trading engine did not respond in time. This is a server connectivity issue.\n\n**Please try:**\n• Waiting a moment and trying again\n• Checking if the trading engine service is running\n• Contacting support if the issue persists';
        } else if (errorMessage.includes('Network') || errorMessage.includes('Failed to fetch')) {
          userFriendlyMessage = '🌐 **Network Connection Error**\n\nUnable to connect to the trading service. Please check your internet connection and try again.';
        } else if (errorMessage.includes('already known') || errorMessage.includes('nonce')) {
          userFriendlyMessage = '⚠️ **Transaction Error**\n\nA transaction conflict was detected. Please wait a moment and try again.';
        } else if (errorMessage.includes('Insufficient') || errorMessage.includes('balance') || errorMessage.includes('Balance')) {
          userFriendlyMessage = `💰 **Balance Issue**\n\n${errorMessage}\n\nPlease check your trading balance and deposit funds if needed.`;
        } else if (errorMessage.includes('Missing required') || errorMessage.includes('required')) {
          userFriendlyMessage = `⚠️ **Configuration Error**\n\n${errorMessage}\n\nPlease check your trading parameters and try again.`;
        } else {
          // For unknown errors, show the actual error message without suggesting balance check
          userFriendlyMessage = `❌ **Error**\n\n${errorMessage}\n\nIf this issue persists, please contact support.`;
        }
        
        setMessages(prev => [...prev, {
          type: "bot",
          content: `❌ **Failed to start trading**\n\n${userFriendlyMessage}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }])
      })
    }
  }, [searchParams, tradingSession, isConnected, totalPortfolioValue, avantisBalance, startTrading, clearSession])

  // Default conversation if no parameters
  useEffect(() => {
    const view = searchParams.get('view')
    if (!searchParams.get('profit') && !searchParams.get('investment') && !view && messages.length === 0) {
      setMessages([{
        type: "bot",
        content: "💰 **Welcome to Real Trading**\n\nConnect your wallet and set your trading parameters to start trading on Avantis with real funds.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }])
    }
  }, [searchParams, messages.length])

  const handleSendMessage = useCallback(async () => {
    if (inputValue.trim()) {
      const newMessage = {
        type: "user" as const,
        content: inputValue.trim(),
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }
      setMessages((prev) => [...prev, newMessage])
      
      // Check if this is a trading prompt
      const tradingPrompt = inputValue.trim().toLowerCase()
      if (tradingPrompt.includes('make') && tradingPrompt.includes('profit') && tradingPrompt.includes('investing')) {
        // Extract profit and investment amounts
        const profitMatch = tradingPrompt.match(/\$(\d+)/g)
        const investmentMatch = tradingPrompt.match(/\$(\d+)/g)
        
        if (profitMatch && investmentMatch && profitMatch.length >= 2) {
          const profitGoal = parseInt(profitMatch[0].replace('$', ''))
          const investmentAmount = parseInt(investmentMatch[1].replace('$', ''))
          
          // Check if there's already an active trading session
          if (tradingSession?.status === 'running') {
            setMessages((prev) => [...prev, {
              type: "bot",
              content: "Trade Already Exists - You Are Only Allowed To Run One Perp Prompt At A Time. Please Wait For The Positions To Hit Profit Goal or Closed Or Liquidated To Run Another Prompt.",
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            }])
          } else {
            // Start new trading session
            setShowTyping(true)
            const sessionId = await startTrading({
              maxBudget: investmentAmount,
              profitGoal: profitGoal,
              maxPerSession: 1
            })
            
            if (sessionId) {
              setTradingPhase("active")
              setMessages((prev) => [...prev, {
                type: "bot",
                content: `🚀 Starting trading session to make $${profitGoal} profit with $${investmentAmount} investment.\n\n📊 **Status:** Monitoring markets and executing trades...\n⚡ **Optimized:** Positions will execute faster with parallel processing\n\n⏳ First position should open within 10-15 seconds...`,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              }])
            } else {
              setMessages((prev) => [...prev, {
                type: "bot",
                content: "❌ Failed to start trading session. Please check your configuration and try again.",
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              }])
            }
            setShowTyping(false)
          }
        } else {
          setShowTyping(true)
          setTimeout(() => {
            setShowTyping(false)
            setMessages((prev) => [...prev, {
              type: "bot",
              content: "I understand you want to trade, but I need specific amounts. Please specify: 'I want to make $X profit by investing $Y'",
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            }])
          }, 2000)
        }
      } else {
        // Regular chat message
        setShowTyping(true)
        setTimeout(() => {
          setShowTyping(false)
          setMessages((prev) => [...prev, {
            type: "bot",
            content: "I'm your PrepX AI Trading Bot! I can help you start automated trading sessions. To begin trading, please specify your profit goal and investment amount like: 'I want to make $30 profit by investing $50'. You can also go to the home page to set your parameters and start trading.",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }])
        }, 2000)
      }
      
      setInputValue("")
    }
  }, [inputValue, tradingSession, startTrading, setTradingPhase])

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSendMessage()
    }
  }, [handleSendMessage])

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => (prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]))
  }, [])

  const handleClosePosition = useCallback(async (positionId: string) => {
    setClosingPositions((prev) => [...prev, positionId])
    
    try {
      let success = false;
      
      if (positionId === "live" && tradingSession?.sessionId) {
        // Close all positions by calling the new endpoint
        const token = getStorageItem('token', '');
        const response = await fetch('/api/close-all-positions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            success = true;
            addToast({
              type: 'success',
              title: 'All positions closed',
              message: `Trading session stopped. Final PnL: $${tradingSession.pnl?.toFixed(2) || '0.00'}`,
            })
            const closeMessage = {
              type: "bot" as const,
              content: `✅ All positions closed successfully! Trading session stopped. Final PnL: $${tradingSession.pnl?.toFixed(2) || '0.00'}`,
              timestamp: new Date().toISOString()
            };
            setMessages(prev => [...prev, closeMessage]);
            setTradingPhase("completed");
            
            // Also stop the trading session
            await stopTrading(tradingSession.sessionId);
            
            // Refresh positions to show updated data
            await fetchPositionsRef.current?.();
          }
        }
      } else {
        // Close individual position
        success = await closeIndividualPosition(positionId);
        
        if (success) {
          addToast({
            type: 'success',
            title: 'Position closed',
            message: `Position ${positionId} closed successfully`,
          })
          const closeMessage = {
            type: "bot" as const,
            content: `✅ Position ${positionId} closed successfully!`,
            timestamp: new Date().toISOString()
          };
          setMessages(prev => [...prev, closeMessage]);
          
          // Refresh positions data
          await fetchPositionsRef.current?.();
        } else {
          addToast({
            type: 'error',
            title: 'Close failed',
            message: `Failed to close position ${positionId}`,
          })
        }
      }
      
      if (!success) {
        const errorMessage = {
          type: "bot" as const,
          content: `❌ Failed to close position ${positionId}. Please try again.`,
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMessage = {
        type: "bot" as const,
        content: `❌ Error closing position ${positionId}. Please try again.`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      // Remove from closing positions list
      setClosingPositions((prev) => prev.filter((id) => id !== positionId));
    }
  }, [tradingSession, closeIndividualPosition, stopTrading]) // Removed fetchPositions - using ref instead

  const handleCloseAllPositions = useCallback(async () => {
    if (!positionData || positionData.openPositions === 0) {
      return;
    }

    // Mark all positions as closing
    const allPositionIds = positionData.positions.map(p => p.coin);
    setClosingPositions(allPositionIds);
    
    try {
      const success = await closeAllPositionsHook();
      
      if (success) {
        const closeMessage = {
          type: "bot" as const,
          content: `✅ All ${positionData.openPositions} positions closed successfully! Final PnL: $${positionData.totalPnL?.toFixed(2) || '0.00'}`,
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, closeMessage]);
        
        // Stop the trading session if it exists
        if (tradingSession?.sessionId) {
          await stopTrading(tradingSession.sessionId);
          setTradingPhase("completed");
        }
        
        // Refresh positions to show updated data
        await fetchPositionsRef.current?.();
      } else {
        const errorMessage = {
          type: "bot" as const,
          content: `❌ Failed to close all positions. Please try again or close them individually.`,
          timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMessage = {
        type: "bot" as const,
        content: `❌ Error closing all positions. Please try again.`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      // Clear all closing positions
      setClosingPositions([]);
    }
  }, [positionData, closeAllPositionsHook, tradingSession, stopTrading]) // Removed fetchPositions

  const toggleTerminal = useCallback(() => {
    setIsTerminalExpanded(!isTerminalExpanded)
  }, [isTerminalExpanded])

  const handleResetChat = useCallback(() => {
    setMessages([])
    setInputValue("")
    setShowTyping(false)
    setTradingPhase("conversation")
    setClosingPositions([])
    setExpandedSections([])
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragStartPosition({ x: e.clientX, y: e.clientY })
    setHasDragged(false)
    setIsDragging(true)
    const rect = (e.target as HTMLElement).closest(".terminal-widget")?.getBoundingClientRect()
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    setDragStartPosition({ x: touch.clientX, y: touch.clientY })
    setHasDragged(false)
    setIsDragging(true)
    const rect = (e.target as HTMLElement).closest(".terminal-widget")?.getBoundingClientRect()
    if (rect) {
      setDragOffset({
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      })
    }
  }, [])

  const handleTerminalClick = useCallback(() => {
    if (!hasDragged) {
      toggleTerminal()
    }
  }, [hasDragged, toggleTerminal])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return

      const moveDistance = Math.sqrt(
        Math.pow(e.clientX - dragStartPosition.x, 2) + Math.pow(e.clientY - dragStartPosition.y, 2),
      )

      if (moveDistance > 5) {
        // 5px threshold
        setHasDragged(true)
      }

      const widgetWidth = 200
      const widgetHeight = 120
      const newRight = Math.max(
        0,
        Math.min(window.innerWidth - widgetWidth, window.innerWidth - (e.clientX + (widgetWidth - dragOffset.x))),
      )
      const newBottom = Math.max(
        0,
        Math.min(window.innerHeight - widgetHeight, window.innerHeight - (e.clientY - dragOffset.y)),
      )

      setTerminalPosition({ right: newRight, bottom: newBottom })
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging) return
      
      // Only prevent default if we're actually dragging and have moved enough
      const touch = e.touches[0]
      const moveDistance = Math.sqrt(
        Math.pow(touch.clientX - dragStartPosition.x, 2) + Math.pow(touch.clientY - dragStartPosition.y, 2),
      )

      if (moveDistance > 5) {
        // 5px threshold
        setHasDragged(true)
        // Only prevent default after we've confirmed we're dragging
        e.preventDefault()
      }

      const widgetWidth = 200
      const widgetHeight = 120
      const newRight = Math.max(
        0,
        Math.min(window.innerWidth - widgetWidth, window.innerWidth - (touch.clientX + (widgetWidth - dragOffset.x))),
      )
      const newBottom = Math.max(
        0,
        Math.min(window.innerHeight - widgetHeight, window.innerHeight - (touch.clientY - dragOffset.y)),
      )

      setTerminalPosition({ right: newRight, bottom: newBottom })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    const handleTouchEnd = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      // Use passive: false only when we need to prevent default
      document.addEventListener("touchmove", handleTouchMove, { passive: false })
      document.addEventListener("touchend", handleTouchEnd)
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.removeEventListener("touchmove", handleTouchMove)
      document.removeEventListener("touchend", handleTouchEnd)
    }
  }, [isDragging, dragOffset, dragStartPosition])


  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-[#0d0d0d] text-white flex flex-col relative">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-4 sm:py-5 border-b border-[#1a1a1a]">
        <Link href="/home" aria-label="Go back to home">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden="true">
            <path
              d="M19 12H5M12 19L5 12L12 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[#4A2C7C] rounded-xl flex items-center justify-center shadow-lg">
            <Image src="/trading-bot-icon.svg" alt="Trading Bot" width={24} height={24} className="w-6 h-6" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-white">PrepX AI</h1>
        </div>

        <button aria-label="Share conversation" className="text-white hover:text-gray-300 transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white" aria-hidden="true">
            <path
              d="M4 12V12.01M12 12V12.01M20 12V12.01M8 8L16 16M16 8L8 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      {/* Chat Content */}
      <main
        className="flex-1 px-4 sm:px-6 md:px-8 py-6 pb-32 sm:pb-36 space-y-4 sm:space-y-6 overflow-y-auto momentum-scroll"
        style={{ touchAction: 'pan-y' }}
        role="log"
        aria-live="polite"
        aria-label="Chat conversation"
      >
        {messages.map((message, index) => (
          <div key={index} className={`flex ${message.type === "user" ? "justify-end" : "justify-start"} mb-3`}>
            {message.type === "user" ? (
              <div className="bg-[#8759ff] rounded-3xl px-5 sm:px-6 py-3.5 sm:py-4 max-w-[85%] sm:max-w-[280px] md:max-w-[320px] shadow-lg">
                <p className="text-white text-sm sm:text-base leading-relaxed">{message.content}</p>
              </div>
            ) : (
              <div className="bg-[#1a1a1a] rounded-3xl px-5 sm:px-6 py-3.5 sm:py-4 max-w-[90%] sm:max-w-[320px] md:max-w-[380px] border border-[#262626] shadow-md">
                <p className="text-white text-sm sm:text-base leading-relaxed whitespace-pre-line">{message.content}</p>
              </div>
            )}
          </div>
        ))}

        {showTyping && (
          <div className="flex justify-start">
            <div className="bg-[#1a1a1a] rounded-3xl px-4 sm:px-6 py-3 sm:py-4 border border-[#262626]">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-[#8759ff] rounded-full animate-pulse"></div>
                <div
                  className="w-2 h-2 bg-[#8759ff] rounded-full animate-pulse"
                  style={{ animationDelay: "0.2s" }}
                ></div>
                <div
                  className="w-2 h-2 bg-[#8759ff] rounded-full animate-pulse"
                  style={{ animationDelay: "0.4s" }}
                ></div>
              </div>
            </div>
          </div>
        )}

        {tradingPhase === "initial" && (
          <div className="space-y-4">
            {/* Technical Analysis */}
            <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl overflow-hidden shadow-md">
              <button
                onClick={() => toggleSection("technical")}
                className="w-full p-5 flex items-center justify-between text-left hover:bg-[#1f1f1f] transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[#27c47d]">
                    <path
                      d="M2 18L7 13L11 17L18 2"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M18 2L13 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div>
                    <h3 className="text-white font-semibold">Technical Analysis</h3>
                    <p className="text-[#b4b4b4] text-sm">
                      AI analyzed market patterns and identified optimal entry points
                    </p>
                  </div>
                </div>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  className={`text-white transition-transform ${expandedSections.includes("technical") ? "rotate-180" : ""}`}
                >
                  <path
                    d="M5 7.5L10 12.5L15 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </Card>

            {/* Risk Management */}
            <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl overflow-hidden shadow-md">
              <button
                onClick={() => toggleSection("risk")}
                className="w-full p-5 flex items-center justify-between text-left hover:bg-[#1f1f1f] transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[#27c47d]">
                    <path
                      d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div>
                    <h3 className="text-white font-semibold">Risk Management</h3>
                    <p className="text-[#b4b4b4] text-sm">Dynamic stop-loss and position sizing calculated</p>
                  </div>
                </div>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  className={`text-white transition-transform ${expandedSections.includes("risk") ? "rotate-180" : ""}`}
                >
                  <path
                    d="M5 7.5L10 12.5L15 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </Card>

            {/* Trade Execution */}
            <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl overflow-hidden">
              <button
                onClick={() => toggleSection("execution")}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <div className="flex items-center space-x-3">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[#facc15]">
                    <path
                      d="M13 2L3 14H12L11 22L21 10H12L13 2Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div>
                    <h3 className="text-white font-semibold">Trade Execution</h3>
                    <p className="text-[#b4b4b4] text-sm">Preparing to execute trades based on analysis</p>
                  </div>
                </div>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  className={`text-white transition-transform ${expandedSections.includes("execution") ? "rotate-180" : ""}`}
                >
                  <path
                    d="M5 7.5L10 12.5L15 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </Card>
          </div>
        )}



        {(tradingPhase === "active" || (tradingSession && tradingSession.status === 'running')) && (
          <div className="space-y-6 px-4 sm:px-6 py-4">
            {/* Trading Session Status */}
            <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 mx-2 sm:mx-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
                  <span className="text-[#27c47d] text-sm font-medium">Trading Active</span>
                </div>
                <span className="text-[#b4b4b4] text-sm">Session: {tradingSession?.sessionId?.slice(-8) || 'N/A'}</span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <p className="text-[#b4b4b4] text-sm">Current PnL</p>
                  <p className={`font-semibold ${(positionData?.totalPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${positionData?.totalPnL?.toFixed(2) || '0.00'}
                  </p>
                </div>
                <div>
                  <p className="text-[#b4b4b4] text-sm">Target Profit</p>
                  <p className="text-white font-semibold">${tradingSession?.config?.profitGoal || '0'}</p>
                </div>
                <div>
                  <p className="text-[#b4b4b4] text-sm">Open Positions</p>
                  <p className="text-white font-semibold">{positionData?.openPositions || 0}</p>
                </div>
                <div>
                  <p className="text-[#b4b4b4] text-sm">Cycle</p>
                  <p className="text-white font-semibold">{tradingSession?.cycle || 0}</p>
                </div>
              </div>
              
              <ProgressIndicator
                progress={Math.min(100, (() => {
                  const pnl = positionData?.totalPnL || 0;
                  const goal = tradingSession?.config?.profitGoal || 1;
                  const positions = positionData?.openPositions || 0;
                  
                  // If PnL is 0 but we have positions, show some progress based on position count
                  if (pnl === 0 && positions > 0) {
                    return Math.min(20, positions * 2); // 2% per position, max 20%
                  }
                  
                  return (pnl / goal) * 100;
                })())}
                label="Progress to goal"
              />
              <p className="text-[#b4b4b4] text-xs mt-2">
                Progress: {(() => {
                  const pnl = positionData?.totalPnL || 0;
                  const goal = tradingSession?.config?.profitGoal || 1;
                  const positions = positionData?.openPositions || 0;
                  
                  if (pnl === 0 && positions > 0) {
                    return `${Math.min(20, positions * 2).toFixed(1)}% (${positions} positions)`;
                  }
                  
                  return `${((pnl / goal) * 100).toFixed(1)}%`;
                })()}
              </p>
            </Card>

            {/* Show position cards when trading is active */}
            {/* Open Positions - Show real positions from Avantis */}
            {positionsLoading ? (
              <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 mx-2 sm:mx-4">
                <CardSkeleton />
              </Card>
            ) : positionData && positionData.openPositions > 0 ? (
              <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 mx-2 sm:mx-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Open Positions</h3>
                  <span className="text-[#b4b4b4] text-sm">{positionData.openPositions} positions</span>
                </div>
                
                {/* Close All Positions Button */}
                {positionData.openPositions > 1 && (
                  <Button
                    onClick={handleCloseAllPositions}
                    disabled={closingPositions.length > 0}
                    className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-3 mb-4 font-semibold"
                  >
                    {closingPositions.length > 0 ? (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Closing All Positions...</span>
                      </div>
                    ) : (
                      `Close All ${positionData.openPositions} Positions`
                    )}
                  </Button>
                )}
                
                {/* Individual Position Cards */}
                <div className="space-y-3">
                  {positionData.positions.map((position, index) => (
                    <Card key={`${position.coin}-${index}`} className="bg-[#2a2a2a] border-[#8759ff] border-2 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-[#8759ff] rounded-full flex items-center justify-center">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
                              <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <div>
                            <span className="text-white font-semibold">{position.coin}</span>
                            <div className="flex items-center space-x-2 mt-1">
                              <span className={`px-2 py-1 rounded text-xs ${position.side === 'long' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                {position.side.toUpperCase()}
                              </span>
                              <span className="text-[#b4b4b4] text-xs">{position.leverage}x</span>
                            </div>
                          </div>
                        </div>
                        <QuickActions
                          position={{
                            coin: position.coin,
                            symbol: position.symbol,
                            pair_index: position.pair_index,
                            index: position.index,
                            takeProfit: position.takeProfit,
                            stopLoss: position.stopLoss,
                          }}
                          onClose={() => {
                            fetchPositions()
                          }}
                          onUpdate={() => {
                            fetchPositions()
                          }}
                        />
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[#b4b4b4]">Entry Price</span>
                          <span className="text-white">${(position.entryPrice && typeof position.entryPrice === 'number') ? position.entryPrice.toFixed(6) : '0.000000'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#b4b4b4]">Mark Price</span>
                          <span className="text-white">${(position.markPrice && typeof position.markPrice === 'number') ? position.markPrice.toFixed(6) : '0.000000'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#b4b4b4]">Size</span>
                          <span className="text-white">{position.size}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#b4b4b4]">Position Value</span>
                          <span className="text-white">${(position.positionValue && typeof position.positionValue === 'number') ? position.positionValue.toFixed(2) : '0.00'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#b4b4b4]">Liq. Price</span>
                          <span className="text-[#dc3545]">
                            {position.liquidationPrice && position.liquidationPrice > 0 
                              ? `$${position.liquidationPrice.toFixed(2)}` 
                              : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#b4b4b4]">PnL (ROE)</span>
                          <span className={`font-semibold ${(position.pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ${(position.pnl && typeof position.pnl === 'number') ? position.pnl.toFixed(2) : '0.00'} ({(position.roe && typeof position.roe === 'number') ? position.roe.toFixed(2) : '0.00'}%)
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#b4b4b4]">Margin</span>
                          <span className="text-white">{position.margin}</span>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </Card>
            ) : positionData && positionData.openPositions === 0 && tradingSession?.status === 'running' ? (
              <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 mx-2 sm:mx-4">
                <EmptyState
                  icon={
                    <svg className="w-16 h-16 text-[#8759ff] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  }
                  title="Monitoring markets"
                  description="Your trading session is active and looking for profitable opportunities. Positions will appear here once opened."
                />
              </Card>
            ) : null}

            {/* Show first position as LIVE POSITION card if positions exist, otherwise show fallback */}
            {tradingSession && positionData && positionData.positions && positionData.positions.length > 0 ? (
              // Show first position as LIVE POSITION card with real data from Avantis
              positionData.positions.slice(0, 1).map((position, idx) => (
                <Card key={`live-${idx}`} className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 mx-2 sm:mx-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-semibold">Open Positions</h3>
                    <span className="text-[#b4b4b4] text-sm">{positionData.openPositions || 0} positions</span>
                  </div>

                  {/* Real position data from Avantis */}
                  <div className="bg-[#2a1a2a] border border-[#262626] rounded-xl p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-[#2563eb] rounded-full flex items-center justify-center">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8 2L8 14L2 8L14 8L8 2Z" fill="white" />
                          </svg>
                        </div>
                        <span className="text-white font-semibold">LIVE POSITION</span>
                        <span className={`${position.side === 'long' ? 'bg-[#27c47d]' : 'bg-red-500'} text-white px-2 py-1 rounded text-xs font-medium`}>
                          {position.side.toUpperCase()}
                        </span>
                        <span className="text-white font-semibold">{position.leverage}x</span>
                      </div>
                      <button 
                        onClick={() => handleClosePosition(position.pair_index ? String(position.pair_index) : position.coin)}
                        className="text-[#b4b4b4] hover:text-white transition-colors"
                      >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">Entry Price</span>
                        <span className="text-white">${position.entryPrice ? position.entryPrice.toFixed(2) : '0.00'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">Position</span>
                        <span className="text-white">${position.positionValue ? position.positionValue.toFixed(2) : '0.00'} USDC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">Collateral</span>
                        <span className="text-white">${position.collateral ? position.collateral.toFixed(2) : (position.margin ? parseFloat(position.margin).toFixed(2) : '0.00')} USDC</span>
                      </div>
                      <hr className="border-[#262626]" />
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">Liq. Price</span>
                        <span className="text-[#dc3545]">
                          {position.liquidationPrice && position.liquidationPrice > 0 
                            ? `$${position.liquidationPrice.toFixed(2)}` 
                            : 'Calculating...'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">SL/TP</span>
                        <span className="text-white text-sm">
                          {position.stopLoss && position.stopLoss > 0 ? `$${position.stopLoss.toFixed(2)}` : 'Auto'} / {position.takeProfit && position.takeProfit > 0 ? `$${position.takeProfit.toFixed(2)}` : 'Auto'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">PnL</span>
                        <span className={position.pnl && position.pnl > 0 ? "text-[#27c47d]" : "text-[#dc3545]"}>
                          ${position.pnl ? position.pnl.toFixed(2) : '0.00'} USDC ({position.roe ? position.roe.toFixed(1) : '0.0'}%)
                        </span>
                      </div>
                      {/* Avantis uses Zero Fee Perpetuals (ZFP) - fees are minimal */}
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">Exit Fee</span>
                        <span className="text-white">0.00 USDC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#b4b4b4]">Funding Fee</span>
                        <span className="text-white">0.00 USDC</span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-white">You&apos;ll Receive</span>
                        <span className="text-white">
                          ${((position.pnl || 0) + (position.collateral || parseFloat(position.margin) || 0)).toFixed(4)} USDC
                        </span>
                      </div>
                    </div>

                    <Button
                      onClick={() => handleClosePosition(position.pair_index ? String(position.pair_index) : position.coin)}
                      disabled={closingPositions.includes(position.pair_index ? String(position.pair_index) : position.coin)}
                      className="w-full bg-[#8759ff] hover:bg-[#7c4dff] text-white rounded-xl py-3"
                    >
                      {closingPositions.includes(position.pair_index ? String(position.pair_index) : position.coin) ? (
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      ) : (
                        "Close Position"
                      )}
                    </Button>

                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-[#262626]">
                      <div>
                        <p className="text-[#b4b4b4] text-sm">Current PnL</p>
                        <p className="text-white font-semibold">${(positionData?.totalPnL || 0).toFixed(2)} USDC</p>
                      </div>
                      <div>
                        <p className="text-[#b4b4b4] text-sm">Open Positions</p>
                        <p className="text-white font-semibold">{positionData?.openPositions || 0}</p>
                      </div>
                    </div>

                    <p className="text-[#b4b4b4] text-sm mt-3">
                      Session: <span className="text-white">{tradingSession.sessionId?.slice(-8)}</span>. Cycle:{" "}
                      <span className="text-white">{tradingSession.cycle}</span>.
                    </p>
                  </div>
                </Card>
              ))
            ) : tradingSession && (!positionData || positionData.openPositions === 0) ? (
              // Fallback: Show empty state when session exists but no positions yet
              <Card className="bg-[#1a1a1a] border-[#262626] rounded-2xl p-4 mx-2 sm:mx-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Open Positions</h3>
                  <span className="text-[#b4b4b4] text-sm">{tradingSession.openPositions || 0} positions</span>
                </div>
                <EmptyState
                  icon={
                    <svg className="w-16 h-16 text-[#8759ff] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  }
                  title="Monitoring markets"
                  description="Your trading session is active and looking for profitable opportunities. Positions will appear here once opened."
                />
              </Card>
            ) : null}

          </div>
        )}

        {tradingPhase === "completed" && (
          <div className="space-y-6 mt-6 px-4 sm:px-6 py-4">
            {/* Show completed session summary - only if session exists and is completed */}
            {tradingSession && tradingSession.status === 'completed' && (
              <Card className="bg-[#1a1a1a] border-l-4 border-l-[#27c47d] border-[#262626] rounded-2xl p-4 mx-2 sm:mx-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[#27c47d] text-sm font-medium">Trading Session Completed</span>
                  <span className="text-[#b4b4b4] text-sm">
                    {tradingSession.endTime ? new Date(tradingSession.endTime).toLocaleTimeString() : 'Just now'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-[#b4b4b4] text-sm">Total PnL</p>
                    <p className={`font-semibold ${(tradingSession.totalPnL || 0) >= 0 ? 'text-[#27c47d]' : 'text-[#dc3545]'}`}>
                      ${(tradingSession.totalPnL || 0).toFixed(2)} USDC
                    </p>
                  </div>
                  <div>
                    <p className="text-[#b4b4b4] text-sm">Positions</p>
                    <p className="text-white font-semibold">{tradingSession.positions || 0}</p>
                  </div>
                  <div>
                    <p className="text-[#b4b4b4] text-sm">Session Duration</p>
                    <p className="text-white">
                      {tradingSession.startTime && tradingSession.endTime 
                        ? `${Math.round((new Date(tradingSession.endTime).getTime() - new Date(tradingSession.startTime).getTime()) / 60000)} min`
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#b4b4b4] text-sm">Status</p>
                    <p className="text-white">Completed</p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {tradingPhase === "conversation" && (
          <div className="flex items-center space-x-2 px-2 sm:px-4">
            <div className="w-2 h-2 bg-[#8759ff] rounded-full animate-pulse"></div>
            <div className="w-2 h-2 bg-[#8759ff] rounded-full animate-pulse" style={{ animationDelay: "0.2s" }}></div>
          </div>
        )}
      </main>

      {/* Bottom Input */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0d0d0d] p-4 sm:p-5 border-t border-[#1a1a1a]">
        <div className="flex items-center space-x-2 sm:space-x-3 bg-[#262626] rounded-full px-3 sm:px-4 py-2.5 sm:py-3 max-w-full">
          <button className="flex-shrink-0 p-1" aria-label="Reset chat" onClick={handleResetChat}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-white sm:w-5 sm:h-5">
              <path
                d="M1.4 10.9C1.4 14.9 4.6 18.1 8.6 18.1C11.4 18.1 13.8 16.4 15 13.9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M18.6 9.1C18.6 5.1 15.4 1.9 11.4 1.9C8.6 1.9 6.2 3.6 5 6.1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M13 16L15 14L17 16"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 4L5 6L3 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <input
            type="text"
            placeholder="Chat with agent"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-1 bg-transparent text-white placeholder:text-[#696969] outline-none text-sm sm:text-base min-w-0"
          />

          <button
            onClick={handleSendMessage}
            className="w-8 h-8 sm:w-10 sm:h-10 bg-[#8759ff] rounded-full flex items-center justify-center flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-white sm:w-4 sm:h-4">
              <path d="M8 3L8 13M8 3L4 7M8 3L12 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Footer Icons */}
        <div className="flex items-center justify-center space-x-4 mt-2 sm:mt-3">
          <div 
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => {
              setIsTerminalExpanded(true)
              setShowLiveCard(true) // Show the live card when opening trading activity
            }}
          >
            <Image 
              src="/hugeicons_trade-up.png" 
              alt="Trade Up" 
              width={20}
              height={20}
              className="w-5 h-5"
            />
            <span className="text-[#696969] text-xs">Trade</span>
          </div>
          <div 
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setShowTradingGoals(true)}
          >
            <Image 
              src="/mage_goals.svg" 
              alt="Goals" 
              width={20}
              height={20}
              className="w-5 h-5"
            />
            <span className="text-[#696969] text-xs">Goals</span>
          </div>
          {!showLiveCard && (
            <div 
              className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setShowLiveCard(true)}
            >
              <div className="w-5 h-5 bg-[#27c47d] rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              </div>
              <span className="text-[#696969] text-xs">Live</span>
            </div>
          )}
        </div>
        
        <p className="text-[#696969] text-xs text-center mt-2">Trade prompt costs 0.05 a-gPT</p>
      </div>

      {/* Small Terminal Widget */}
      {!isTerminalExpanded && showLiveCard && tradingSession && (
        <div
          className={`terminal-widget fixed z-50 transition-all duration-75 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          style={{
            right: `${terminalPosition.right}px`,
            bottom: `${terminalPosition.bottom}px`,
            touchAction: "none", // Prevent default touch behaviors
          }}
        >
          <div
            className="bg-[#1a1a1a] border border-[#262626] rounded-lg p-3 shadow-lg hover:bg-[#262626] transition-colors select-none"
            style={{ touchAction: "none" }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onClick={handleTerminalClick}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-1">
                <div className="w-1 h-1 bg-[#696969] rounded-full"></div>
                <div className="w-1 h-1 bg-[#696969] rounded-full"></div>
                <div className="w-1 h-1 bg-[#696969] rounded-full"></div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowLiveCard(false)
                }}
                className="text-[#696969] hover:text-white transition-colors p-1"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-[#27c47d] rounded-full animate-pulse"></div>
              <span className="text-white text-xs font-medium">Live</span>
            </div>
            <div className="mt-2 text-xs text-[#b4b4b4]">
              <div className="flex items-center space-x-1">
                <span className="text-[#27c47d]">●</span>
                <span>
                  {tradingSession ? `Monitoring ${tradingSession.sessionId}` : 'No active trade'}
                </span>
              </div>
              <div className="text-[#facc15]">
                PnL: ${positionData?.totalPnL?.toFixed(2) || '0.00'} / ${tradingSession?.config?.profitGoal || '0'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Terminal Overlay */}
      {isTerminalExpanded && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="w-full bg-[#0d0d0d] rounded-t-3xl animate-slide-up max-h-[85vh] sm:max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-[#262626] flex-shrink-0">
              <h2 className="text-white text-lg sm:text-xl font-bold">Live Trading Activity</h2>
              <button 
                onClick={() => {
                  toggleTerminal()
                  setShowLiveCard(false) // Also hide the small live card when closing the modal
                }} 
                className="text-white hover:text-[#b4b4b4] p-1"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
              {/* Monitoring Status */}
              <Card className="bg-[#1a1a1a] border-[#262626] rounded-xl p-3 sm:p-4">
                <div className="flex items-start space-x-2 mb-3">
                  <div className="w-4 h-4 bg-[#2563eb] rounded flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs">💻</span>
                  </div>
                  <span className="text-[#58a6ff] font-mono text-xs sm:text-sm break-all">
                    {tradingSession ? `********** Monitoring ${tradingSession.sessionId || tradingSession.id || 'session'} **********` : 'No active trading session'}
                  </span>
                </div>

                <div className="space-y-2 text-xs sm:text-sm">
                  <div className="text-[#b4b4b4]">
                    Total allowed positions: {tradingSession?.config?.maxPerSession || 0} for budget is {tradingSession?.config?.maxBudget || 0}
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[#facc15] flex-shrink-0">💰</span>
                    <span className="text-white">
                      Total PnL: ${tradingSession?.pnl?.toFixed(2) || '0.00'} / ${tradingSession?.config?.profitGoal || '0'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[#b4b4b4] flex-shrink-0">🔒</span>
                    <span className="text-white">Open positions: {tradingSession?.openPositions || 0}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[#b4b4b4] flex-shrink-0">🔄</span>
                    <span className="text-white">Cycle: {tradingSession?.cycle || 0}</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-[#27c47d] flex-shrink-0 mt-0.5">✅</span>
                    <span className="text-white break-words">
                      Status: {tradingSession?.status || 'No active session'}
                    </span>
                  </div>
                </div>
                
                {/* Session Control Buttons */}
                <div className="mt-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => refreshSessionStatus(false)}
                      className="bg-[#4A2C7C] hover:bg-[#5A3C8C] text-white rounded-lg py-2"
                    >
                      🔄 Refresh
                    </Button>
                    
                    <Button
                      onClick={() => {
                        clearSession();
                        setShowLiveCard(false);
                        setTradingPhase('initial');
                      }}
                      className="bg-[#dc2626] hover:bg-[#b91c1c] text-white rounded-lg py-2"
                    >
                      🗑️ Clear
                    </Button>
                  </div>
                  
                  {tradingSession?.status === 'stopped' && (
                    <Button
                      onClick={() => {
                        clearSession();
                        setShowLiveCard(false);
                      }}
                      className="w-full bg-[#6b7280] hover:bg-[#4b5563] text-white rounded-lg py-2"
                    >
                      🗑️ Clear Session
                    </Button>
                  )}
                </div>
              </Card>

              {/* Technical Analysis - Only show when trading is active */}
              {tradingSession && tradingSession.status === 'running' && (
                <Card className="bg-[#1a1a1a] border-[#262626] rounded-xl p-3 sm:p-4">
                  <div className="flex items-start space-x-2 mb-3">
                    <span className="text-[#58a6ff] flex-shrink-0">📊</span>
                    <span className="text-white font-mono text-xs sm:text-sm break-words">
                      [Status] Trading bot is monitoring markets and evaluating signals...
                    </span>
                  </div>
                  {positionData && positionData.positions && positionData.positions.length > 0 && (
                    <div className="flex items-start space-x-2">
                      <span className="text-[#f472b6] flex-shrink-0">🎯</span>
                      <span className="text-white font-mono text-xs sm:text-sm break-words">
                        [Positions] {positionData.positions.length} active position(s) on AvantisFi | 
                        Total PnL: <span className={positionData.totalPnL >= 0 ? 'text-[#27c47d]' : 'text-[#dc3545]'}>
                          ${positionData.totalPnL?.toFixed(2) || '0.00'}
                        </span>
                      </span>
                    </div>
                  )}
                </Card>
              )}

              {/* Trade Execution - Only show if positions actually exist */}
              {positionData && positionData.positions && positionData.positions.length > 0 ? (
                <Card className="bg-[#1a1a1a] border-[#262626] rounded-xl p-3 sm:p-4">
                  <div className="space-y-3 font-mono text-xs sm:text-sm">
                    <div className="text-[#27c47d] text-sm font-semibold mb-2">
                      ✅ Real Positions from AvantisFi ({positionData.positions.length})
                    </div>
                    {positionData.positions.slice(0, 3).map((pos, idx) => (
                      <div key={idx} className="flex items-start space-x-2">
                        <span className="text-[#27c47d] flex-shrink-0">✅</span>
                        <span className="text-white break-words">
                          {pos.symbol || pos.coin} | {pos.side?.toUpperCase() || 'N/A'} | 
                          Entry: {pos.entryPrice?.toFixed(4) || 'N/A'} | 
                          Leverage: {pos.leverage || 'N/A'}x | 
                          PnL: <span className={pos.pnl >= 0 ? 'text-[#27c47d]' : 'text-[#dc3545]'}>
                            ${pos.pnl?.toFixed(2) || '0.00'}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <Card className="bg-[#1a1a1a] border-[#262626] rounded-xl p-3 sm:p-4">
                  <div className="text-center py-4">
                    <div className="text-[#b4b4b4] text-sm mb-2">📊 No Open Positions</div>
                    <div className="text-[#666] text-xs">
                      Positions will appear here when opened on AvantisFi
                    </div>
                  </div>
                </Card>
              )}

              <div className="h-4"></div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>

      {/* AI Trading Goals Modal */}
      {showTradingGoals && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-[#1a1a1a] rounded-2xl p-6 w-full max-w-md mx-4 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-[#8759ff] rounded-full flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white">
                    <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="currentColor"/>
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-white">AI Trading Goals</h2>
              </div>
              <button 
                onClick={() => setShowTradingGoals(false)}
                className="text-white hover:text-gray-300 transition-colors"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[#b4b4b4] text-sm mb-2">Target Profit</label>
                <div className="flex items-center bg-[#262626] rounded-lg px-3 py-2">
                  <span className="text-white text-lg font-semibold mr-2">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={targetProfit}
                    onChange={(e) => setTargetProfit(e.target.value)}
                    className="bg-transparent text-white text-lg font-semibold flex-1 outline-none"
                    placeholder="10"
                  />
                  <span className="text-[#b4b4b4] ml-2">USD</span>
                </div>
              </div>

              <div>
                <label className="block text-[#b4b4b4] text-sm mb-2">Investment Amount</label>
                <div className="flex items-center bg-[#262626] rounded-lg px-3 py-2">
                  <span className="text-white text-lg font-semibold mr-2">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={investmentAmount}
                    onChange={(e) => setInvestmentAmount(e.target.value)}
                    className="bg-transparent text-white text-lg font-semibold flex-1 outline-none"
                    placeholder="50"
                  />
                  <span className="text-[#b4b4b4] ml-2">USD</span>
                </div>
              </div>

              <button 
                onClick={async () => {
                  // Validate inputs
                  const profit = parseFloat(targetProfit);
                  const investment = parseFloat(investmentAmount);
                  
                  if (!profit || profit <= 0) {
                    alert('Please enter a valid target profit amount');
                    return;
                  }
                  
                  if (!investment || investment <= 0) {
                    alert('Please enter a valid investment amount');
                    return;
                  }
                  
                  if (investment < 10) {
                    alert('Minimum investment amount is $10');
                    return;
                  }
                  
                  try {
                    // Real trading only - check wallet connection
                    if (!isConnected) {
                      setMessages(prev => [...prev, {
                        type: "bot",
                        content: "❌ **Wallet Required**\n\nPlease connect your wallet first to start trading. Real trading requires a connected wallet with funds.",
                        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      }])
                      return
                    }
                    
                    if (totalPortfolioValue === 0 || avantisBalance < 10) {
                      setMessages(prev => [...prev, {
                        type: "bot",
                        content: `⚠️ **Insufficient Balance**\n\nYour current Avantis trading balance is **$${avantisBalance.toFixed(2)}**. The minimum required balance to start trading is **$10.00**.\n\n**Please deposit funds** to your Avantis trading vault before starting a trading session.`,
                        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      }])
                      return
                    }
                    
                    // Start trading with the specified parameters
                    await startTrading({
                      profitGoal: profit,
                      maxBudget: investment,
                      maxPerSession: 1
                    });
                    
                    // Close the modal
                    setShowTradingGoals(false);
                    
                    // Show the live trading card
                    setShowLiveCard(true);
                    
                    // Add a message to the chat indicating trading has started
                    const newMessage = {
                      type: "bot" as const,
                      content: `🚀 Trading session started! I'm now working to achieve your target profit of $${targetProfit} with an investment of $${investmentAmount}. I'll keep you updated on the progress and show you real-time trading activity.`,
                      timestamp: new Date().toISOString()
                    };
                    setMessages(prev => [...prev, newMessage]);
                    
                  } catch (error) {
                    // Add error message to chat
                    const errorMessage = {
                      type: "bot" as const,
                      content: "❌ Sorry, I couldn't start the trading session. Please try again or check your connection.",
                      timestamp: new Date().toISOString()
                    };
                    setMessages(prev => [...prev, errorMessage]);
                  }
                }}
                className="w-full bg-[#8759ff] hover:bg-[#7C3AED] text-white font-bold py-3 rounded-lg transition-colors"
              >
                Start Trading
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trading Analysis Modal */}
      {showTradingAnalysis && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="w-full bg-[#0d0d0d] rounded-t-3xl animate-slide-up max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-[#262626] flex-shrink-0">
              <h2 className="text-white text-lg sm:text-xl font-bold">Trading Analysis</h2>
              <button onClick={() => setShowTradingAnalysis(false)} className="text-white hover:text-[#b4b4b4] p-1">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#262626]">
                <h3 className="text-white font-semibold mb-3">Market Overview</h3>
                <p className="text-[#b4b4b4] text-sm">Current market conditions and analysis...</p>
              </div>
              
              <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#262626]">
                <h3 className="text-white font-semibold mb-3">Risk Assessment</h3>
                <p className="text-[#b4b4b4] text-sm">Risk analysis and recommendations...</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  )
}

