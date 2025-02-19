'use client';
import useAuth from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import FeatureCards from '@/components/landing/FeatureCards';
import LoginOptions from '@/components/landing/LoginOptions';

export default function Home() {
  const router = useRouter();
  const { user, loading, loginWithGoogle, loginAsGuest, loginWithEmailAndPassword } = useAuth();

  // If user is already authenticated, redirect to dashboard
  if (user) {
    router.push('/dashboard');
    return null;
  }

  if (loading) {
    return <div className="min-h-screen bg-white dark:bg-gray-900" />;
  }

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
      router.push('/dashboard');
    } catch (error) {
      console.error('Login error', error);
    }
  };

  const handleGuestLogin = async () => {
    try {
      await loginAsGuest();
      router.push('/dashboard');
    } catch (error) {
      console.error('Guest login error', error);
    }
  };

  const handleTestLogin = async () => {
    try {
      await loginWithEmailAndPassword('testuser@example.com', 'TestPassword123');
      router.push('/dashboard');
    } catch (error) {
      console.error('Test login failed:', error);
    }
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center">
        <div className="flex flex-col items-center text-center mx-auto max-w-2xl px-4">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-tight">
            AI-Помощник для Подготовки Проповедей
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
            Фиксируйте мысли в процессе размышления, преобразуйте речь в текст<br />
            и автоматически структурируйте проповеди с анализом смысловых пробелов
          </p>
        </div>
        <FeatureCards />
        <LoginOptions onGoogleLogin={handleLogin} onGuestLogin={handleGuestLogin} onTestLogin={handleTestLogin} />
      </main>
    </div>
  );
}