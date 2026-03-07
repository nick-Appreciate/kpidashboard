// Shared chart color palette for dark theme
export const CHART_COLORS = {
  cyan: '#06b6d4',
  emerald: '#34d399',
  violet: '#8b5cf6',
  amber: '#fbbf24',
  rose: '#fb7185',
  blue: '#60a5fa',
  orange: '#fb923c',
  teal: '#2dd4bf',
  pink: '#f472b6',
  lime: '#a3e635',
};

export const CHART_PALETTE = Object.values(CHART_COLORS);

// Chart.js global defaults for dark theme
export const DARK_CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      labels: {
        color: '#94a3b8',
        font: { family: 'Inter, sans-serif', size: 12 },
        boxWidth: 12,
        padding: 16,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#f1f5f9',
      bodyColor: '#cbd5e1',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      borderWidth: 1,
      cornerRadius: 8,
      padding: 12,
      titleFont: { family: 'Inter, sans-serif', weight: '600' },
      bodyFont: { family: 'Inter, sans-serif' },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
      ticks: { color: '#64748b', font: { family: 'Inter, sans-serif', size: 11 } },
    },
    y: {
      grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
      ticks: { color: '#64748b', font: { family: 'Inter, sans-serif', size: 11 } },
    },
  },
};

// For doughnut/pie charts (no scales)
export const DARK_DOUGHNUT_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: DARK_CHART_DEFAULTS.plugins.legend,
    tooltip: DARK_CHART_DEFAULTS.plugins.tooltip,
  },
};

// Recharts theme constants
export const RECHARTS_THEME = {
  grid: { stroke: 'rgba(255, 255, 255, 0.05)' },
  axis: { stroke: '#64748b', fontSize: 11, fontFamily: 'Inter, sans-serif' },
  tooltip: {
    contentStyle: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      color: '#f1f5f9',
    },
  },
};

// Waste chart palette — rose/amber tones to communicate cost/danger
export const WASTE_PALETTE = ['#f43f5e', '#fb923c', '#f97316', '#ef4444', '#e11d48', '#dc2626', '#f59e0b', '#b91c1c', '#ea580c', '#be123c'];

// Leasing funnel stage colors — single source of truth
export const STAGE_COLORS = {
  inquiries:          '#06b6d4', // cyan
  showings_scheduled: '#60a5fa', // blue
  showings_completed: '#8b5cf6', // violet
  applications:       '#fbbf24', // amber
  leases:             '#34d399', // emerald
};

// Helper to create a gradient fill for Chart.js line charts
export function createGradientFill(ctx, color, height = 300) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color.replace(')', ', 0.3)').replace('rgb', 'rgba'));
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  return gradient;
}
