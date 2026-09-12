import * as React from 'react'

export interface TableProps {
  children: React.ReactNode
  className?: string
}

export function Table({ children, className = '' }: TableProps): React.JSX.Element {
  return (
    <div className={`overflow-x-auto w-full ${className}`}>
      <table className="w-full text-left text-sm text-gray-600 dark:text-gray-300 divide-y divide-gray-200 dark:divide-gray-800">
        {children}
      </table>
    </div>
  )
}

export function TableHeader({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <thead className="bg-gray-50 text-xs uppercase font-semibold text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
      {children}
    </thead>
  )
}

export function TableBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 bg-white dark:bg-gray-900">
      {children}
    </tbody>
  )
}

export function TableRow({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <tr className={`hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors ${className}`}>
      {children}
    </tr>
  )
}

export function TableHead({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <th scope="col" className={`px-4 py-3 font-semibold ${className}`}>
      {children}
    </th>
  )
}

export function TableCell({
  children,
  className = '',
  colSpan,
}: {
  children: React.ReactNode
  className?: string
  colSpan?: number
}): React.JSX.Element {
  return (
    <td
      colSpan={colSpan}
      className={`px-4 py-3 text-gray-700 dark:text-gray-200 whitespace-nowrap ${className}`}
    >
      {children}
    </td>
  )
}
