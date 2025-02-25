import React, { useState } from 'react';

interface ColorPickerModalProps {
  tagName: string;
  initialColor: string;
  onOk: (newColor: string) => void;
  onCancel: () => void;
}

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({ tagName, initialColor, onOk, onCancel }) => {
  const [selectedColor, setSelectedColor] = useState(initialColor);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
        <h2 className="text-lg font-semibold mb-4">Edit Color for {tagName}</h2>
        <input
          type="color"
          value={selectedColor}
          onChange={(e) => setSelectedColor(e.target.value)}
          className="w-16 h-16 mb-4"
        />
        <div className="flex justify-end space-x-4">
          <button
            onClick={() => onOk(selectedColor)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >OK</button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
          >Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal; 