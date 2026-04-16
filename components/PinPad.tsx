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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        setPin(prev => {
          if (prev.length < 4) {
            setError('');
            return prev + e.key;
          }
          return prev;
        });
      } else if (e.key === 'Backspace') {
        setPin(prev => {
          setError('');
          return prev.slice(0, -1);
        });
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

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
    <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-zinc-100 max-w-md w-full mx-auto">
      <div className={`p-8 text-white text-center ${mode === 'IN' ? 'bg-zinc-900' : 'bg-red-600'}`}>
        <div className="relative">
          <button
            onClick={onCancel}
            className="absolute -right-2 -top-2 p-2 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <h2 className="text-3xl font-bold mb-1">
            {mode === 'IN' ? 'Clock In' : 'Clock Out'}
          </h2>
          <p className="text-white/80 text-sm">Enter your 4-digit PIN</p>
        </div>
      </div>

      <div className="p-10 flex flex-col items-center">
        {/* PIN Display */}
        <div className="flex gap-6 mb-10">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full border-2 transition-all duration-200 
                ${i < pin.length
                  ? 'bg-zinc-800 border-zinc-800 scale-125'
                  : 'bg-transparent border-zinc-300'}`}
            />
          ))}
        </div>

        {error && (
          <div className="mb-6 text-red-500 font-bold text-sm animate-bounce">
            {error}
          </div>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-8 w-full max-w-[360px] mt-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleNumClick(num.toString())}
              className="aspect-square flex items-center justify-center rounded-full bg-zinc-50 hover:bg-zinc-100 active:bg-zinc-200 text-4xl font-bold text-zinc-700 transition-all shadow-sm border border-zinc-100 active:scale-90"
            >
              {num}
            </button>
          ))}
          <div className="flex justify-center">
            {/* Empty space for grid alignment if needed, but we'll use col-start */}
          </div>
          <button
            onClick={() => handleNumClick('0')}
            className="aspect-square flex items-center justify-center rounded-full bg-zinc-50 hover:bg-zinc-100 active:bg-zinc-200 text-4xl font-bold text-zinc-700 transition-all shadow-sm border border-zinc-100 active:scale-90"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="aspect-square flex items-center justify-center rounded-full hover:bg-red-50 active:bg-red-100 text-zinc-400 hover:text-red-500 transition-all active:scale-90"
          >
            <Delete className="w-10 h-10" />
          </button>
        </div>
      </div>
    </div>
  );
};