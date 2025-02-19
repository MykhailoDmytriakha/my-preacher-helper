import React from 'react';

export default function FeatureCards() {
  return (
    <div className="grid md:grid-cols-3 gap-8 w-full max-w-4xl mb-16">
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
  );
} 