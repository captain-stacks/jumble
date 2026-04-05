import { PRIMARY_COLORS, StorageKey, TPrimaryColor } from '@/constants'
import storage from '@/services/local-storage.service'
import { TTheme, TThemeSetting } from '@/types'
import { createContext, useContext, useEffect, useState } from 'react'

type ThemeProviderState = {
  theme: TTheme
  themeSetting: TThemeSetting
  setThemeSetting: (themeSetting: TThemeSetting) => void
  pureBlack: boolean
  setPureBlack: (value: boolean) => void
  primaryColor: TPrimaryColor
  setPrimaryColor: (color: TPrimaryColor) => void
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

const updateCSSVariables = (color: TPrimaryColor, currentTheme: TTheme) => {
  const root = window.document.documentElement
  const colorConfig = PRIMARY_COLORS[color] ?? PRIMARY_COLORS.DEFAULT

  const config = currentTheme === 'light' ? colorConfig.light : colorConfig.dark

  root.style.setProperty('--primary', config.primary)
  root.style.setProperty('--primary-hover', config['primary-hover'])
  root.style.setProperty('--primary-foreground', config['primary-foreground'])
  root.style.setProperty('--ring', config.ring)
}

function loadThemeSetting(): TThemeSetting {
  const stored = localStorage.getItem(StorageKey.THEME_SETTING)
  // migrate legacy 'pure-black' value
  if (stored === 'pure-black') return 'dark'
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function loadPureBlack(migratedFromPureBlack: boolean): boolean {
  const stored = localStorage.getItem(StorageKey.PURE_BLACK)
  if (stored !== null) return stored === 'true'
  // migrate: if old theme was pure-black, enable pureBlack
  return migratedFromPureBlack
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const rawStored = localStorage.getItem(StorageKey.THEME_SETTING)
  const wasPureBlack = rawStored === 'pure-black'

  const [themeSetting, setThemeSetting] = useState<TThemeSetting>(loadThemeSetting)
  const [pureBlack, setPureBlack] = useState<boolean>(() => loadPureBlack(wasPureBlack))
  const [theme, setTheme] = useState<TTheme>('light')
  const [primaryColor, setPrimaryColor] = useState<TPrimaryColor>(
    (localStorage.getItem(StorageKey.PRIMARY_COLOR) as TPrimaryColor) ?? 'DEFAULT'
  )

  useEffect(() => {
    let resolvedTheme: 'light' | 'dark'

    if (themeSetting === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        const resolved: 'light' | 'dark' = e.matches ? 'dark' : 'light'
        setTheme(pureBlack && resolved === 'dark' ? 'pure-black' : resolved)
      }
      mediaQuery.addEventListener('change', handleChange)
      resolvedTheme = mediaQuery.matches ? 'dark' : 'light'

      const computed = pureBlack && resolvedTheme === 'dark' ? 'pure-black' : resolvedTheme
      setTheme(computed)

      return () => {
        mediaQuery.removeEventListener('change', handleChange)
      }
    } else {
      resolvedTheme = themeSetting
      setTheme(pureBlack && resolvedTheme === 'dark' ? 'pure-black' : resolvedTheme)
    }
  }, [themeSetting, pureBlack])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme === 'pure-black' ? 'dark' : theme)

    if (theme === 'pure-black') {
      root.classList.add('pure-black')
    } else {
      root.classList.remove('pure-black')
    }
  }, [theme])

  useEffect(() => {
    updateCSSVariables(primaryColor, theme)
  }, [theme, primaryColor])

  const updateThemeSetting = (value: TThemeSetting) => {
    storage.setThemeSetting(value)
    setThemeSetting(value)
  }

  const updatePureBlack = (value: boolean) => {
    localStorage.setItem(StorageKey.PURE_BLACK, value.toString())
    setPureBlack(value)
  }

  const updatePrimaryColor = (color: TPrimaryColor) => {
    storage.setPrimaryColor(color)
    setPrimaryColor(color)
  }

  return (
    <ThemeProviderContext.Provider
      value={{
        theme,
        themeSetting,
        setThemeSetting: updateThemeSetting,
        pureBlack,
        setPureBlack: updatePureBlack,
        primaryColor,
        setPrimaryColor: updatePrimaryColor
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
