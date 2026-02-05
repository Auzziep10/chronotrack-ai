import React from 'react';
import { WorkLog, Department } from '../types';
import { ClipboardList, Trash2 } from 'lucide-react';

interface Props {
  logs: WorkLog[];
  onDelete?: (id: string) => void;
}

export const HistoryLog: React.FC<Props> = ({ logs, onDelete }) => {
  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 bg-white rounded-lg shadow-sm">
        <ClipboardList className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No work logs submitted yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden">
      <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Work History</h3>
      </div>
      <ul className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
        {logs.slice().reverse().map((log) => (
          <li key={log.id} className="p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                    ${log.department === Department.Production ? 'bg-purple-100 text-purple-800' : 
                      log.department === Department.Design ? 'bg-indigo-100 text-indigo-800' : 
                      'bg-green-100 text-green-800'}`}>
                    {log.department}
                  </span>
                  <span className="text-sm text-gray-500">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-900">{log.task}</p>
                {log.department === Department.Production && log.productionData && (
                  <div className="mt-1 text-sm text-gray-600 bg-gray-50 p-2 rounded border border-gray-100">
                    <span className="font-semibold">Project:</span> {log.productionData.projectName} <br />
                    <span className="font-semibold">Qty:</span> {log.productionData.quantity}
                  </div>
                )}
                {log.notes && <p className="mt-1 text-sm text-gray-500 italic">"{log.notes}"</p>}
              </div>
              {onDelete && (
                <button 
                  onClick={() => onDelete(log.id)}
                  className="ml-4 text-gray-400 hover:text-red-500"
                  title="Delete Log"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};