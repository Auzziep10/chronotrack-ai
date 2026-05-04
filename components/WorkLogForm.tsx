import React, { useState, useEffect } from 'react';
import { Department, WorkLog, ProductionData } from '../types';
import { DEPARTMENT_TASKS } from '../constants';
import { DepartmentSelector } from './DepartmentSelector';
import { Save, AlertCircle, ClipboardCheck } from 'lucide-react';

interface Props {
  onSubmit: (log: Omit<WorkLog, 'id' | 'timestamp' | 'periodStart' | 'periodEnd'>) => void;
  isRequired?: boolean; // If true, visually emphasize importance
  title?: string;
  prefillNotes?: string;
  initialDepartment?: Department | string;
}

export const WorkLogForm: React.FC<Props> = ({ onSubmit, isRequired, title, prefillNotes, initialDepartment }) => {
  const [department, setDepartment] = useState<Department | ''>((initialDepartment as Department) || '');
  const [task, setTask] = useState<string>('');
  const [productionData, setProductionData] = useState<ProductionData>({ projectName: '', quantity: 0 });
  const [notes, setNotes] = useState<string>(prefillNotes || '');
  const [progress, setProgress] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (prefillNotes) {
      setNotes(prefillNotes);
    }
  }, [prefillNotes]);

  // Reset task when department changes
  useEffect(() => {
    setTask('');
    setProductionData({ projectName: '', quantity: 0 });
    setErrors([]);
  }, [department]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: string[] = [];

    if (!department) newErrors.push('Department is required.');
    if (!task) newErrors.push('Activity description is required.');
    
    if (department === Department.Production) {
      if (!productionData.projectName.trim()) newErrors.push('Project Name is required for Production.');
      if (productionData.quantity <= 0) newErrors.push('Quantity must be greater than 0 for Production.');
    }

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    const logData: any = {
      department: department as Department,
      task,
      notes: progress !== null ? `[${progress}% Complete] ${notes}`.trim() : notes,
    };

    if (department === Department.Production) {
      logData.productionData = productionData;
    }

    onSubmit(logData);
    
    // Clear form
    setTask('');
    setNotes('');
    setProgress(null);
    setProductionData({ projectName: '', quantity: 0 });
    setErrors([]);
  };

  const currentTasks = department ? DEPARTMENT_TASKS[department] : [];

  return (
    <form onSubmit={handleSubmit} className={`bg-white p-6 rounded-lg shadow-md ${isRequired ? 'border-t-4 border-red-500' : 'border-t-4 border-zinc-300'}`}>
      <h3 className={`text-xl font-bold mb-6 flex items-center gap-2 ${isRequired ? 'text-red-700' : 'text-zinc-800'}`}>
        {isRequired ? <AlertCircle className="w-6 h-6" /> : <ClipboardCheck className="w-6 h-6 text-zinc-900" />}
        {title || (isRequired ? 'Hourly Activity Summary Required' : 'Log Activity')}
      </h3>

      <DepartmentSelector selectedDept={department} onChange={setDepartment} />

      {department && (
        <div className="animate-fade-in space-y-4">
          {department === Department.Production && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Project Name</label>
              <input
                type="text"
                value={productionData.projectName}
                onChange={(e) => setProductionData({ ...productionData, projectName: e.target.value })}
                className="w-full border border-zinc-300 rounded-md shadow-sm p-2 focus:ring-zinc-500 focus:border-zinc-300"
                placeholder="Enter Project Name"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              {department === Department.Production ? 'Activity Performed' : 'Description of Work'}
            </label>
            <select
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="w-full border border-zinc-300 rounded-md shadow-sm p-2 focus:ring-zinc-500 focus:border-zinc-300"
            >
              <option value="" disabled>Select Activity</option>
              {currentTasks.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {department === Department.Production && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Quantity Completed</label>
              <input
                type="number"
                min="1"
                value={productionData.quantity || ''}
                onChange={(e) => setProductionData({ ...productionData, quantity: parseInt(e.target.value) || 0 })}
                className="w-full border border-zinc-300 rounded-md shadow-sm p-2 focus:ring-zinc-500 focus:border-zinc-300"
                placeholder="Qty"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Additional Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-zinc-300 rounded-md shadow-sm p-2 focus:ring-zinc-500 focus:border-zinc-300"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">Task Progress</label>
            <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1">
              {[0, 25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setProgress(pct)}
                  className={`flex-1 shrink-0 px-3 py-1.5 rounded-md text-sm font-bold transition-all border ${
                    progress === pct 
                      ? 'bg-zinc-900 text-white border-zinc-900 shadow-sm' 
                      : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100 hover:text-zinc-900'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
          <ul className="list-disc pl-4 space-y-1">
            {errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      <button
        type="submit"
        className={`w-full mt-6 flex items-center justify-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white transition-all
        ${isRequired ? 'bg-red-600 hover:bg-red-700 ring-2 ring-red-500 ring-offset-2' : 'bg-zinc-900 hover:bg-zinc-800'} focus:outline-none`}
      >
        <Save className="w-4 h-4" />
        {isRequired ? 'Submit Required Summary' : 'Submit Log'}
      </button>
    </form>
  );
};