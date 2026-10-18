'use client'

import React, { useState, useEffect } from 'react'
import { useAutoNotifications, useActivityFeed } from '@/hooks/useNotifications'
import {
  usePushNotifications,
  type NotificationData,
  type ActivityItem
} from '@/lib/pushNotifications'
import { useIsMobile } from '@/lib/responsive'
import { LoadError } from '@/components/LoadError'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  Bell, 
  X, 
  Check, 
  CheckCheck, 
  Settings,
  Activity,
  Clock,
  User,
  FileText,
  Vote,
  DollarSign,
  Users,
  Wallet,
  Shield
} from 'lucide-react'
import { VirtualizedList } from '@/components/ui/virtualized-list'

interface NotificationCenterProps {
  className?: string
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ className = '' }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'notifications' | 'activity'>('notifications')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  
  const isMobile = useIsMobile()

  const {
    notifications,
    isError: notificationsError,
    refetch: refetchNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
    requestPermission,
    enableAutoNotifications,
    disableAutoNotifications,
    autoNotifyEnabled,
    startListening,
    stopListening,
    isListening
  } = useAutoNotifications()

  const { activities, isError: activityError, refetch: refetchActivity } = useActivityFeed(50)
  const { supported, permission } = usePushNotifications()

  // Auto-start listening when component mounts
  useEffect(() => {
    if (!isListening && autoNotifyEnabled) {
      startListening()
    }
  }, [isListening, autoNotifyEnabled, startListening])

  const filteredNotifications = notifications.filter(notif => 
    filter === 'all' || !notif.read
  )

  const getActivityIcon = (type: ActivityItem['type']) => {
    const iconMap = {
      loan: DollarSign,
      vote: Vote,
      proposal: FileText,
      member: Users,
      treasury: Wallet,
      document: Shield
    }
    const Icon = iconMap[type] || Activity
    return <Icon className="w-4 h-4" />
  }

  // Only the dot's bg color is actually used (see the split(' ')[1] call
  // below) — a solid mid-tone so the dot reads clearly in both themes.
  const getNotificationTypeColor = (type: NotificationData['type']) => {
    const colorMap = {
      info: 'text-blue-600 bg-blue-500 border-blue-200',
      success: 'text-green-600 bg-green-500 border-green-200',
      warning: 'text-yellow-600 bg-yellow-500 border-yellow-200',
      error: 'text-red-600 bg-red-500 border-red-200'
    }
    return colorMap[type] || colorMap.info
  }

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className={`relative ${className}`}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        {/* Notification Bell Button */}
        <PopoverTrigger asChild>
          <button
            className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Notifications"
            aria-label="Open notifications"
          >
            <Bell className="w-6 h-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </PopoverTrigger>

        {/* Notification Panel — a non-modal Popover: Escape closes it and
            returns focus to the bell trigger, opening moves focus into the
            panel, and outside clicks dismiss it, all handled by Radix. The
            background is intentionally left interactive (no backdrop/scroll
            lock), matching a popover rather than a modal dialog. */}
        <PopoverContent
          align={isMobile ? 'center' : 'end'}
          aria-label="Notifications"
          className={`p-0 ${isMobile ? 'w-screen rounded-t-xl' : 'w-96'} border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${isMobile ? 'max-h-screen' : 'max-h-96'} flex flex-col`}
        >
            {/* Header */}
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-foreground">Notifications</h3>
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Close notifications"
                  className="p-1 hover:bg-accent rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex space-x-1 bg-muted rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('notifications')}
                  className={`flex-1 ${isMobile ? 'text-xs py-3' : 'text-sm py-2'} px-3 rounded-md transition-colors ${
                    activeTab === 'notifications'
                      ? 'bg-card shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Notifications {unreadCount > 0 && `(${unreadCount})`}
                </button>
                <button
                  onClick={() => setActiveTab('activity')}
                  className={`flex-1 ${isMobile ? 'text-xs py-3' : 'text-sm py-2'} px-3 rounded-md transition-colors ${
                    activeTab === 'activity'
                      ? 'bg-card shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Activity
                </button>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between mt-3">
                {activeTab === 'notifications' && (
                  <>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setFilter('all')}
                        className={`text-xs px-2 py-1 rounded ${
                          filter === 'all'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setFilter('unread')}
                        className={`text-xs px-2 py-1 rounded ${
                          filter === 'unread'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        Unread
                      </button>
                    </div>

                    {filteredNotifications.length > 0 && (
                      <div className="flex space-x-1">
                        <button
                          onClick={markAllAsRead}
                          className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          aria-label="Mark all as read"
                        >
                          <CheckCheck className="w-4 h-4" />
                        </button>
                        <button
                          onClick={clearAllNotifications}
                          className="text-xs text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          aria-label="Clear all notifications"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </>
                )}

                {activeTab === 'activity' && (
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex items-center text-xs ${
                      isListening ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
                    }`}>
                      <Activity className={`w-3 h-3 mr-1 ${isListening ? 'animate-pulse' : ''}`} />
                      {isListening ? 'Live' : 'Paused'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'notifications' ? (
                <div className="divide-y divide-border">
                  {notificationsError && filteredNotifications.length === 0 ? (
                    <LoadError what="notifications" onRetry={() => void refetchNotifications()} className="m-4" />
                  ) : filteredNotifications.length === 0 ? (
                    <div className={`${isMobile ? 'p-6' : 'p-8'} text-center text-muted-foreground`}>
                      <Bell className={`${isMobile ? 'w-8 h-8' : 'w-12 h-12'} mx-auto mb-3 opacity-30`} />
                      <p className={isMobile ? 'text-sm' : ''}>No notifications yet</p>
                      <p className="text-xs mt-1">
                        {!autoNotifyEnabled ? (
                          <button
                            onClick={enableAutoNotifications}
                            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Enable notifications
                          </button>
                        ) : (
                          "You're all caught up!"
                        )}
                      </p>
                    </div>
                  ) : (
                    <VirtualizedList
                      items={filteredNotifications}
                      threshold={30}
                      itemHeight={90}
                      className="divide-y divide-border"
                      listAriaLabel="Notifications list"
                      keyExtractor={(n) => n.id}
                      renderItem={(notification) => (
                        <div
                          className={`p-3 hover:bg-accent cursor-pointer ${
                            !notification.read ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                          }`}
                          onClick={() => {
                            markAsRead(notification.id)
                            if (notification.actionUrl) {
                              window.location.href = notification.actionUrl
                              setIsOpen(false)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              markAsRead(notification.id)
                              if (notification.actionUrl) {
                                window.location.href = notification.actionUrl
                                setIsOpen(false)
                              }
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <div className={`w-2 h-2 rounded-full ${
                                  getNotificationTypeColor(notification.type).split(' ')[1]
                                }`} />
                                <h4 className={`text-sm font-medium ${
                                  !notification.read ? 'text-foreground' : 'text-foreground'
                                }`}>
                                  {notification.title}
                                </h4>
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">
                                {notification.message}
                              </p>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(notification.timestamp)}
                                </span>
                                {!notification.read && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      markAsRead(notification.id)
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                    aria-label="Mark as read"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                removeNotification(notification.id)
                              }}
                              className="ml-2 p-1 hover:bg-accent rounded"
                              title="Remove"
                              aria-label="Remove notification"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    />
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {activityError && activities.length === 0 ? (
                    <LoadError what="recent activity" onRetry={() => void refetchActivity()} className="m-4" />
                  ) : activities.length === 0 ? (
                    <div className={`${isMobile ? 'p-6' : 'p-8'} text-center text-muted-foreground`}>
                      <Activity className={`${isMobile ? 'w-8 h-8' : 'w-12 h-12'} mx-auto mb-3 opacity-30`} />
                      <p className={isMobile ? 'text-sm' : ''}>No recent activity</p>
                      <p className="text-xs mt-1">
                        DAO events will appear here as they happen
                      </p>
                    </div>
                  ) : (
                    <VirtualizedList
                      items={activities}
                      threshold={30}
                      itemHeight={90}
                      className="divide-y divide-border"
                      listAriaLabel="Activity feed"
                      keyExtractor={(activity) => activity.id}
                      renderItem={(activity) => (
                        <div className="p-3 hover:bg-accent">
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0 mt-1 text-muted-foreground">
                              {getActivityIcon(activity.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-foreground mb-1">
                                {activity.title}
                              </h4>
                              <p className="text-sm text-muted-foreground mb-2">
                                {activity.description}
                              </p>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <div className="flex items-center space-x-2">
                                  <Clock className="w-3 h-3" />
                                  <span>{formatTime(activity.timestamp)}</span>
                                </div>
                                {activity.user && (
                                  <div className="flex items-center space-x-1">
                                    <User className="w-3 h-3" />
                                    <span className="truncate max-w-20">
                                      {activity.user}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-border bg-muted rounded-b-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                  <Settings className="w-3 h-3" />
                  <span>Settings</span>
                </div>

                <div className="flex items-center space-x-2">
                  {activeTab === 'notifications' && (
                    <>
                      <button
                        onClick={autoNotifyEnabled ? disableAutoNotifications : enableAutoNotifications}
                        className={`text-xs px-2 py-1 rounded ${
                          autoNotifyEnabled
                            ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60'
                            : 'bg-muted text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        {autoNotifyEnabled ? 'Auto On' : 'Auto Off'}
                      </button>

                      {supported && permission !== 'granted' && (
                        <button
                          onClick={requestPermission}
                          className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                        >
                          Enable Push
                        </button>
                      )}
                    </>
                  )}

                  {activeTab === 'activity' && (
                    <button
                      onClick={isListening ? stopListening : startListening}
                      className={`text-xs px-2 py-1 rounded ${
                        isListening
                          ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60'
                          : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60'
                      }`}
                    >
                      {isListening ? 'Stop' : 'Start'}
                    </button>
                  )}
                </div>
              </div>
            </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default NotificationCenter
