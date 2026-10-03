/* eslint import/order: off */
import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";

import { LocalizedToaster } from "./components/LocalizedToaster";
import { OfflineBanner } from "./components/OfflineBanner";
import { SkipLink } from "./components/navigation/SkipLink";
import { ThemeWatcher } from "./components/ThemeWatcher";
import LanguageInitializer from "./components/navigation/LanguageInitializer";
import { AuthProvider } from "./providers/AuthProvider";
import { ConnectionProvider } from "./providers/ConnectionProvider";
import { QueryProvider } from "./providers/QueryProvider";
import { TextScaleProvider } from "./providers/TextScaleProvider";
import { APP_THEME_COLORS } from "./utils/themeColors";
import { THEME_INIT_SCRIPT } from "./utils/themeInitScript";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

const interSans = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"]
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: 'My Preacher Helper',
  description: "Записывайте мысли, преобразуйте речь в текст и автоматически улучшайте проповеди с помощью искусственного интеллекта",
  icons: {
    icon: [
      { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'My Preacher Helper',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: APP_THEME_COLORS.theme,
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${interSans.variable} ${robotoMono.variable} antialiased`}
        suppressHydrationWarning={true}
      >
        <SkipLink />
        <ThemeWatcher />
        <TextScaleProvider>
          <AuthProvider>
            <ConnectionProvider>
              <QueryProvider>
                <NuqsAdapter>
                  <LanguageInitializer />
                  <LocalizedToaster />
                  <div className="min-h-screen flex flex-col" id="app-shell">
                    <OfflineBanner />
                    {children}
                  </div>
                </NuqsAdapter>
              </QueryProvider>
            </ConnectionProvider>
          </AuthProvider>
        </TextScaleProvider>
      </body>
    </html>
  );
}
