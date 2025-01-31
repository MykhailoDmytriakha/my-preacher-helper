'use client'; // Required for client-side interactivity
import { useState } from "react";
import { signInWithGoogle, signInAsGuest, logOut } from "@/lib/firebaseAuth";
import Image from "next/image";
import { User } from "firebase/auth";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);

  const handleLogin = async () => {
    const userData = await signInWithGoogle();
    setUser(userData);
  };

  const handleGuestLogin = async () => {
    const userData = await signInAsGuest();
    setUser(userData);
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="flex flex-col items-center text-center mx-auto max-w-2xl px-4">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-tight">
            AI-Помощник для Проповедников
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
            Записывайте мысли, преобразуйте речь в текст<br/>и автоматически улучшайте проповеди<br/>с помощью искусственного интеллекта
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 w-full max-w-4xl">
          <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-blue-600 to-blue-400 flex items-center justify-center text-2xl text-white">
                🎙️
              </div>
              <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Запись голоса
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Мгновенная запись мыслей в любой момент через браузер с автоматическим сохранением в облако
              </p>
            </div>
          </div>

          <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-purple-600 to-pink-500 flex items-center justify-center text-2xl text-white">
                ✨
              </div>
              <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                AI-Обработка
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Автоматическое улучшение текста: удаление повторов, шумов и формирование четкой структуры
              </p>
            </div>
          </div>

          <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-green-600 to-cyan-500 flex items-center justify-center text-2xl text-white">
                🏷️
              </div>
              <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Авто-тегирование
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Интеллектуальное разделение на вступление, основную часть и заключение с тематическими метками
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row w-full justify-center">
          {user ? (
            <button 
              className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-lg"
              onClick={() => {/* Add recording handler */}}
            >
              🎤 Начать запись
            </button>
          ) : (
            <div className="flex flex-col gap-4 items-center p-8 rounded-2xl bg-white dark:bg-gray-800 shadow-lg w-full max-w-md border dark:border-gray-700">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Добро пожаловать
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  Начните создавать проповеди<br/>с помощью AI-ассистента
                </p>
              </div>
              
              <div className="w-full space-y-3">
                <button 
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-green-600 text-white rounded-lg 
                    hover:from-blue-700 hover:to-green-700 transition-all flex items-center justify-center gap-2"
                  onClick={handleLogin}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="18" height="18" viewBox="0 0 48 48">
                    <path fill="#fbc02d" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12	s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20	s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                    <path fill="#e53935" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039	l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                    <path fill="#4caf50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                    <path fill="#1565c0" d="M43.611,20.083L43.595,20L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                  </svg>
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
                  className="w-full px-6 py-3 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg
                    hover:bg-gray-100 dark:hover:bg-gray-600 transition-all flex items-center justify-center gap-2"
                  onClick={handleGuestLogin}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  Продолжить как гость
                </button>
              </div>
              
              <p className="text-center text-xs text-gray-400 mt-4">
                Нажимая продолжить, вы принимаете наши<br/>
                <a href="#" className="text-blue-600 hover:underline">Условия использования</a>
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
