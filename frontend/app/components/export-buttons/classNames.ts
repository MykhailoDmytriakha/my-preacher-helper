export const getTxtIconButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400"
    : "text-gray-400 hover:bg-blue-50 hover:text-blue-600 dark:text-gray-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-400";

export const getPdfIconButtonClassName = (isPdfAvailable: boolean, isPreached: boolean) => {
  if (!isPdfAvailable) {
    return "text-gray-300 cursor-not-allowed dark:text-gray-700";
  }

  return isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-purple-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-purple-400"
    : "text-gray-400 hover:bg-purple-50 hover:text-purple-600 dark:text-gray-500 dark:hover:bg-purple-900/30 dark:hover:text-purple-400";
};

export const getWordIconButtonClassName = (isWordDisabled: boolean, isPreached: boolean) => {
  if (isWordDisabled) {
    return "text-gray-300 cursor-not-allowed dark:text-gray-700";
  }

  return isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-green-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-green-400"
    : "text-gray-400 hover:bg-green-50 hover:text-green-600 dark:text-gray-500 dark:hover:bg-green-900/30 dark:hover:text-green-400";
};

export const getAudioIconButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "text-gray-500 hover:bg-gray-200 hover:text-orange-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-orange-400"
    : "text-gray-400 hover:bg-orange-50 hover:text-orange-600 dark:text-gray-500 dark:hover:bg-orange-900/30 dark:hover:text-orange-400";

export const getTxtTextButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900 dark:hover:text-blue-300"
    : "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800";

export const getPdfTextButtonClassName = (isPdfAvailable: boolean, isPreached: boolean) => {
  if (isPreached) {
    return isPdfAvailable
      ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-900 dark:hover:text-purple-300"
      : "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 opacity-50 cursor-not-allowed";
  }

  return isPdfAvailable
    ? "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800"
    : "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 opacity-50 cursor-not-allowed";
};

export const getWordTextButtonClassName = (isWordDisabled: boolean, isPreached: boolean) => {
  if (isWordDisabled) {
    return "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-50";
  }

  return isPreached
    ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900 dark:hover:text-green-300"
    : "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800";
};

export const getAudioTextButtonClassName = (isPreached: boolean) =>
  isPreached
    ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-orange-100 hover:text-orange-600 dark:hover:bg-orange-900 dark:hover:text-orange-300"
    : "bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800";
