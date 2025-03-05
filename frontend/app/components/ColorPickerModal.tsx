import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ColorPickerModalProps {
  tagName: string;
  initialColor: string;
  onOk: (newColor: string) => void;
  onCancel: () => void;
}

// Predefined color palette 
const colorPresets = [
  // Reds
  '#FF6B6B', '#FF4757', '#EF5777', '#D63031', 
  // Oranges
  '#FF9F43', '#FA8231', '#FFA502', '#E67E22',
  // Yellows
  '#FECA57', '#FED330', '#F7B731', '#FFC312',
  // Greens
  '#1DD1A1', '#10AC84', '#26DE81', '#2ECC71',
  // Blues
  '#54A0FF', '#2E86DE', '#18DCFF', '#0652DD',
  // Purples
  '#5F27CD', '#8854D0', '#A3CB38', '#6C5CE7',
  // Pinks
  '#FF9FF3', '#F368E0', '#FF78CB', '#D980FA',
  // Grays
  '#808E9B', '#2F3542', '#747D8C', '#57606F',
];

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({ tagName, initialColor, onOk, onCancel }) => {
  const { t } = useTranslation();
  const [selectedColor, setSelectedColor] = useState(initialColor);
  const [customColor, setCustomColor] = useState(initialColor);

  const handleSelectColor = (color: string) => {
    setSelectedColor(color);
    setCustomColor(color);
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setCustomColor(newColor);
    setSelectedColor(newColor);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold mb-5 text-gray-800 dark:text-gray-100">
          {t('settings.editColorFor')} <span className="text-blue-500">{tagName}</span>
        </h2>
        
        {/* Color preview */}
        <div className="mb-6 flex flex-col items-center">
          <div 
            className="w-20 h-20 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 mb-2 transition-all duration-200"
            style={{ backgroundColor: selectedColor }}
          />
          <span className="font-mono text-sm text-gray-600 dark:text-gray-300">{selectedColor}</span>
        </div>
        
        {/* Color presets */}
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            {t('settings.presetColors')}
          </h3>
          <div className="grid grid-cols-8 gap-2">
            {colorPresets.map((color, index) => (
              <button
                key={index}
                className={`w-8 h-8 rounded-md cursor-pointer transition-transform hover:scale-110 hover:shadow-md ${
                  selectedColor === color ? 'ring-2 ring-blue-500 ring-offset-1 scale-110' : ''
                }`}
                style={{ backgroundColor: color }}
                onClick={() => handleSelectColor(color)}
                aria-label={`Color ${color}`}
              />
            ))}
          </div>
        </div>
        
        {/* Custom color picker */}
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            {t('settings.customColor')}
          </h3>
          <div className="flex items-center gap-4">
            <input
              type="color"
              value={customColor}
              onChange={handleCustomColorChange}
              className="w-10 h-10 p-1 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
            />
            <input
              type="text"
              value={customColor}
              onChange={(e) => handleSelectColor(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md 
                        bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-mono"
              placeholder="#000000"
            />
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 
                    rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => onOk(selectedColor)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                    transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal; 