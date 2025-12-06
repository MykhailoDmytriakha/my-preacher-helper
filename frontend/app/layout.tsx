import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from './providers/AuthProvider';
import { TextScaleProvider } from './providers/TextScaleProvider';
import { QueryProvider } from './providers/QueryProvider';
import LanguageInitializer from './components/navigation/LanguageInitializer';

const interSans = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"]
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  description: "Записывайте мысли, преобразуйте речь в текст и автоматически улучшайте проповеди с помощью искусственного интеллекта",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body 
        className={`${interSans.variable} ${robotoMono.variable} antialiased`}
        suppressHydrationWarning={true}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[9999] focus:top-4 focus:left-4 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg dark:focus:bg-gray-800"
        >
          Skip to main content
        </a>
        <TextScaleProvider>
          <AuthProvider>
            <QueryProvider>
              <LanguageInitializer />
              <div className="min-h-screen flex flex-col" id="app-shell">
                {children}
              </div>
            </QueryProvider>
          </AuthProvider>
        </TextScaleProvider>
      </body>
    </html>
  );
}
