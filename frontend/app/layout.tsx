import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import dynamic from 'next/dynamic';
import { AuthProvider } from './providers/AuthProvider';

// Dynamically import the LanguageInitializer component to ensure it only runs on client-side
const LanguageInitializer = dynamic(
  () => import('./components/navigation/LanguageInitializer'),
  { ssr: false }
);

const interSans = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"]
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "Помощник проповедника",
  description: "Записывайте мысли, преобразуйте речь в текст и автоматически улучшайте проповеди с помощью искусственного интеллекта",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body 
        className={`${interSans.variable} ${robotoMono.variable} antialiased`}
        suppressHydrationWarning={true}
      >
        <AuthProvider>
          <LanguageInitializer />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
