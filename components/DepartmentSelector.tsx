import React from 'react';
import { Department } from '../types';
import { DEPARTMENT_TASKS } from '../constants';

interface Props {
  selectedDept: Department | '';
  onChange: (dept: Department) => void;
}

export const DepartmentSelector: React.FC<Props> = ({ selectedDept, onChange }) => {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
      <select
        value={selectedDept}
        onChange={(e) => onChange(e.target.value as Department)}
        className="w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="" disabled>Select Department</option>
        {Object.keys(DEPARTMENT_TASKS).map((dept) => (
          <option key={dept} value={dept}>
            {dept}
          </option>
        ))}
      </select>
    </div>
  );
};