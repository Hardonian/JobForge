import * as React from 'react'

export interface CardProps {
  children: React.ReactNode
  className?: string
  title?: string
  description?: string
  action?: React.ReactNode
}

export function Card({
  children,
  className = '',
  title,
  description,
  action,
}: CardProps): React.JSX.Element {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      {(title || description || action) && (
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-gray-800">
          <div>
            {title && <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>}
            {description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
            )}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

export interface MetricCardProps {
  title: string
  value: string | number
  change?: string
  trend?: 'up' | 'down' | 'neutral'
  subtitle?: string
  className?: string
}

export function MetricCard({
  title,
  value,
  change,
  trend = 'neutral',
  subtitle,
  className = '',
}: MetricCardProps): React.JSX.Element {
  const trendColor =
    trend === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend === 'down'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-gray-500 dark:text-gray-400'

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
          {value}
        </span>
        {change && <span className={`text-xs font-semibold ${trendColor}`}>{change}</span>}
      </div>
      {subtitle && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{subtitle}</p>}
    </div>
  )
}
