import React, { useState } from 'react';
import { X, Calendar, Clock, Save } from 'lucide-react';
import { User } from '../types';

interface Props {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (clockInMs: number, clockOutMs: number, idleHours: number, date: string, notes: string) => void;
}

export const AddRetroactiveCardModal: React.FC<Props> = ({ user, isOpen, onClose, onSave }) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(todayStr);
  const [clockInTime, setClockInTime] = useState('08:00');
  const [clockOutTime, setClockOutTime] = useState('17:00');
  const [idleHours, setIdleHours] = useState('0');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  if (!isOpen || !user) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!date) {
      setError('Date is required.');
      return;
    }
    if (!clockInTime || !clockOutTime) {
      setError('Clock In and Clock Out times are required.');
      return;
    }

    const clockInMs = new Date(date + 'T' + clockInTime + ':00').getTime();
    const clockOutMs = new Date(date + 'T' + clockOutTime + ':00').getTime();

    if (isNaN(clockInMs) || isNaN(clockOutMs)) {
      setError('Invalid date or time format.');
      return;
    }

    if (clockInMs >= clockOutMs) {
      setError('Clock In time must be before Clock Out time.');
      return;
    }

    const idleHoursNum = parseFloat(idleHours) || 0;
    const durationHours = (clockOutMs - clockInMs) / 3600000;
    if (idleHoursNum >= durationHours) {
      setError('Idle hours cannot exceed total shift duration.');
      return;
    }

    onSave(clockInMs, clockOutMs, idleHoursNum, date, notes);
    
    // Reset state
    setDate(todayStr);
    setClockInTime('08:00');
    setClockOutTime('17:00');
    setIdleHours('0');
    setNotes('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-[95vw] max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-zinc-900 p-6 text-white flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-zinc-400" />
              Add Retroactive Time Card
            </h3>
            <p className="text-zinc-400 text-sm mt-0.5">Create a past timecard record for {user.name}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors p-2 hover:bg-zinc-800 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content / Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-xs font-bold p-3 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5 ml-0.5">Date</label>
              <input
                type="date"
                value={date}
                max={todayStr}
                onChange={(e) => setDate(e.target.value)}
                className="w-full text-sm font-medium border border-zinc-200 rounded-xl px-3 py-2.5 bg-zinc-50/50 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 transition-all shadow-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5 ml-0.5">Clock In</label>
                <div className="input-icon-wrapper">
                  <Clock className="text-zinc-400" />
                  <input
                    type="time"
                    value={clockInTime}
                    onChange={(e) => setClockInTime(e.target.value)}
                    className="w-full text-sm font-medium border border-zinc-200 rounded-xl pl-10 pr-3 py-2.5 bg-zinc-50/50 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 transition-all shadow-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5 ml-0.5">Clock Out</label>
                <div className="input-icon-wrapper">
                  <Clock className="text-zinc-400" />
                  <input
                    type="time"
                    value={clockOutTime}
                    onChange={(e) => setClockOutTime(e.target.value)}
                    className="w-full text-sm font-medium border border-zinc-200 rounded-xl pl-10 pr-3 py-2.5 bg-zinc-50/50 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 transition-all shadow-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5 ml-0.5">Idle Time (Unpaid)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={idleHours}
                  onChange={(e) => setIdleHours(e.target.value)}
                  className="w-full text-sm font-medium border border-zinc-200 rounded-xl pl-3 pr-10 py-2.5 bg-zinc-50/50 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 transition-all shadow-sm"
                />
                <span className="absolute right-3.5 top-3 text-xs text-zinc-400 font-bold">hrs</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1.5 ml-0.5">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why is this record being added? e.g. 'Retroactive entry - missed clock-in'..."
                rows={3}
                className="w-full text-sm border border-zinc-200 rounded-xl p-3 bg-zinc-50/50 focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 transition-all shadow-sm"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-zinc-100 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-5 py-3 text-sm font-bold text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-xl transition-all shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all active:scale-[0.98]"
            >
              <Save className="w-4 h-4" />
              Add Record
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
