import React, { useState } from 'react';
import { X, AlertOctagon, HeartPulse, ShieldAlert, Save } from 'lucide-react';
import { User } from '../types';

interface Props {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (type: 'No-Call No-Show' | 'Sick' | 'Emergency', notes: string) => void;
}

type AbsenceType = 'No-Call No-Show' | 'Sick' | 'Emergency';

export const LogAbsenceModal: React.FC<Props> = ({ user, isOpen, onClose, onSave }) => {
  const [selectedType, setSelectedType] = useState<AbsenceType | null>(null);
  const [notes, setNotes] = useState('');

  if (!isOpen || !user) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedType) {
      onSave(selectedType, notes);
      setSelectedType(null);
      setNotes('');
      onClose();
    }
  };

  const options = [
    {
      type: 'No-Call No-Show' as AbsenceType,
      title: 'No-Call No-Show',
      description: 'Employee failed to report to work and did not notify management in advance.',
      icon: AlertOctagon,
      bgClass: 'bg-red-50 hover:bg-red-100/80 border-red-200 text-red-900',
      activeClass: 'ring-2 ring-red-600 bg-red-100/90 border-red-400',
      iconClass: 'text-red-600',
    },
    {
      type: 'Sick' as AbsenceType,
      title: 'Sick Day',
      description: 'Employee called in sick or reported a personal medical issue/appointment.',
      icon: HeartPulse,
      bgClass: 'bg-blue-50 hover:bg-blue-100/80 border-blue-200 text-blue-900',
      activeClass: 'ring-2 ring-blue-600 bg-blue-100/90 border-blue-400',
      iconClass: 'text-blue-600',
    },
    {
      type: 'Emergency' as AbsenceType,
      title: 'Family Emergency',
      description: 'Employee requested time off for an unforeseen urgent family event or emergency.',
      icon: ShieldAlert,
      bgClass: 'bg-purple-50 hover:bg-purple-100/80 border-purple-200 text-purple-900',
      activeClass: 'ring-2 ring-purple-600 bg-purple-100/90 border-purple-400',
      iconClass: 'text-purple-600',
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-[95vw] max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-zinc-900 p-6 text-white flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold">Log Absence</h3>
            <p className="text-zinc-400 text-sm mt-0.5">Record attendance status for {user.name}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors p-2 hover:bg-zinc-800 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content / Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Absence Category
            </label>
            <div className="grid grid-cols-1 gap-3">
              {options.map((opt) => {
                const IconComponent = opt.icon;
                const isSelected = selectedType === opt.type;
                return (
                  <div
                    key={opt.type}
                    onClick={() => setSelectedType(opt.type)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 flex gap-4 items-start ${
                      isSelected ? opt.activeClass : opt.bgClass
                    }`}
                  >
                    <div className={`p-2 bg-white rounded-lg border border-zinc-200/50 shadow-sm ${opt.iconClass}`}>
                      <IconComponent className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-sm text-zinc-900 leading-tight">
                        {opt.title}
                      </h4>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                        {opt.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Manager Notes / Detail
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Provide context e.g. 'Called at 8:15 AM regarding flat tire' or 'No message received'..."
              rows={3}
              className="w-full text-sm border border-zinc-200 rounded-xl shadow-sm focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 p-3 bg-zinc-50/50"
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-zinc-100 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-5 py-3 text-sm font-bold text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-xl transition-all shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedType}
              className="flex-1 flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all active:scale-[0.98]"
            >
              <Save className="w-4 h-4" />
              Log Absence
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
