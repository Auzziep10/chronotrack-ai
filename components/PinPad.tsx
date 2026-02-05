import React, { useState, useEffect } from 'react';
import { Delete, X } from 'lucide-react';
import { User } from '../types';

interface Props {
  mode: 'IN' | 'OUT';
  users: User[];
  onSuccess: (user: User) => void;
  onCancel: () => void;
}

export const PinPad: React.FC<Props> = ({ mode, users, onSuccess, onCancel }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleNumClick = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError('');
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  useEffect(() => {
    if (pin.length === 4) {
      // Validate PIN against passed users list
      const user = users.find(u => u.pin === pin);
      if (user) {
        // Small delay for visual feedback
        setTimeout(() => onSuccess(user), 300);
      } else {
        setError('Invalid PIN');
        setPin('');
      }
    }
  }, [pin, onSuccess, users]);

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 max-w-sm w-full mx-auto animate-scale-in">
      <div className={`p-6 text-white text-center ${mode === 'IN' ? 'bg-blue-600' : 'bg-red-600'}`}>
        <div className="relative">
          <button 
            onClick={onCancel}
            className="absolute -right-2 -top-2 p-2 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold mb-1">
            {mode === 'IN' ? 'Clock In' : 'Clock Out'}
          </h2>
          <p className="text-blue-100 opacity-90 text-sm">Enter your 4-digit PIN</p>
        </div>
      </div>

      <div className="p-8 flex flex-col items-center">
        {/* PIN Display */}
        <div className="flex gap-4 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <div 
              key={i} 
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 
                ${i < pin.length 
                  ? 'bg-gray-800 border-gray-800 scale-110' 
                  : 'bg-transparent border-gray-300'}`}
            />
          ))}
        </div>

        {error && (
          <div className="mb-4 text-red-500 font-medium text-sm animate-pulse">
            {error}
          </div>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-4 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleNumClick(num.toString())}
              className="h-16 w-full rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-2xl font-semibold text-gray-700 transition-colors shadow-sm border border-gray-100"
            >
              {num}
            </button>
          ))}
          <div className="col-start-2">
            <button
              onClick={() => handleNumClick('0')}
              className="h-16 w-full rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-2xl font-semibold text-gray-700 transition-colors shadow-sm border border-gray-100"
            >
              0
            </button>
          </div>
          <div className="col-start-3">
             <button
              onClick={handleDelete}
              className="h-16 w-full rounded-xl hover:bg-red-50 active:bg-red-100 text-gray-500 hover:text-red-500 transition-colors flex items-center justify-center"
            >
              <Delete className="w-8 h-8" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};