export const theme = {
  colors: {
    background: '#f8fafc', // Slate 50
    card: '#ffffff',
    cardBorder: '#e2e8f0', // Slate 200
    primary: '#0f172a', // Slate 900 (Professional Navy/Black)
    primaryDark: '#020617', // Slate 950
    danger: '#dc2626', // Red 600
    dangerDark: '#991b1b', // Red 800
    text: '#0f172a', // Slate 900
    textSecondary: '#64748b', // Slate 500
    accent: '#2563eb', // Blue 600
    divider: '#f1f5f9', // Slate 100
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    pill: 9999,
  },
  shadows: {
    glass: {
      shadowColor: '#64748b',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 2,
    },
    glowPrimary: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 3,
    }
  }
};
