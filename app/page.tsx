'use client';
import useAuth from '@/hooks/useAuth';
import { GoogleIcon, UserIcon } from '@components/Icons';
import { useRouter } from 'next/navigation';

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

        <div className="grid md:grid-cols-3 gap-8 w-full max-w-4xl">
          <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-blue-600 to-blue-400 flex items-center justify-center text-2xl text-white">
                🎙️
              </div>
              <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Мгновенная запись
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Фиксация мыслей по мере их появления с автоматическим сохранением в облако и преобразованием речи в текст
              </p>
            </div>
          </div>

          <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-purple-600 to-pink-500 flex items-center justify-center text-2xl text-white">
                ✨
              </div>
              <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                AI-Структурирование
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Автоматическое улучшение текста: удаление повторов, формирование логичного потока и стилистическая правка
              </p>
            </div>
          </div>

          <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-green-600 to-cyan-500 flex items-center justify-center text-2xl text-white">
                🏷️
              </div>
              <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Анализ содержания
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Интеллектуальное разделение на структурные части с выявлением смысловых пробелов и дисбалансов
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 items-center p-8 rounded-2xl bg-white dark:bg-gray-800 shadow-lg w-full max-w-md border dark:border-gray-700">
          <div className="text-center space-y-2 w-full">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Начните использовать
            </h2>
          </div>
          
          <div className="w-full space-y-3">
            <button 
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-200 to-green-200 rounded-lg hover:from-blue-700 hover:to-green-700 transition-all flex items-center justify-center gap-2"
              onClick={handleLogin}
            >
              <GoogleIcon className="w-5 h-5" />
              Войти через Google
            </button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">или</span>
              </div>
            </div>

            <button
              className="w-full px-6 py-3 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-all flex items-center justify-center gap-2"
              onClick={handleGuestLogin}
            >
              <UserIcon className="w-5 h-5" />
              Продолжить как гость
            </button>

            {/* Add Test User Login Button - Only in Development */}
            {process.env.NODE_ENV === 'development' && (
              <button
                className="w-full px-6 py-3 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-lg hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-all flex items-center justify-center gap-2"
                onClick={handleTestLogin}
              >
                <UserIcon className="w-5 h-5" />
                Войти как тестовый пользователь
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}