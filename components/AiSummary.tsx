import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { WorkLog } from '../types';
import { generateDailySummary } from '../services/geminiService';

interface Props {
  logs: WorkLog[];
}

export const AiSummary: React.FC<Props> = ({ logs }) => {
  const [summary, setSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleGenerate = async () => {
    setIsOpen(true);
    setIsLoading(true);
    setSummary(null);
    const result = await generateDailySummary(logs);
    setSummary(result);
    setIsLoading(false);
  };

  if (!isOpen && !isLoading) {
    return (
      <button
        onClick={handleGenerate}
        disabled={logs.length === 0}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md hover:from-purple-700 hover:to-indigo-700 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Sparkles className="w-4 h-4" />
        Generate AI Report
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-indigo-50">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Daily AI Summary
          </h3>
          <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
              <p className="text-sm text-gray-500 animate-pulse">Analyzing work patterns...</p>
            </div>
          ) : (
            <div className="prose prose-purple max-w-none">
              <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                {summary}
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button 
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};