export interface DashboardMetrics {
  totalFrames: number | null
  totalRevenue: number | null
  totalVendues: number | null
}

export function extractDashboardMetrics(payload: any): DashboardMetrics
export function formatDashboardMetric(value: number | null | undefined): string
