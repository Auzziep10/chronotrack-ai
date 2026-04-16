import React, { useState } from 'react';
import { X, Settings, Database, Cloud, Info, UserPlus, Users, Calendar, Check, UserCog, Trash2 } from 'lucide-react';
import { User, AppSettings, PayFrequency, DayOfWeek, DailyAvailability, Department } from '../types';
import { DAYS_OF_WEEK } from '../constants';
import { UserProfileDialog } from './UserProfileDialog';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  onAddUser: (user: User) => void;
  onUpdateUser: (user: User) => void;
  onDeleteUser: (userId: string) => void;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

export const SettingsDialog: React.FC<Props> = ({ isOpen, onClose, users, onAddUser, onUpdateUser, onDeleteUser, settings, onUpdateSettings }) => {
  const [newUser, setNewUser] = useState({ name: '', role: '', pin: '' });
  const [userError, setUserError] = useState('');

  // Profile Dialog State
  const [editingUser, setEditingUser] = useState<User | null>(null);

  if (!isOpen) return null;

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.role || !newUser.pin) {
      setUserError('All fields are required.');
      return;
    }
    if (newUser.pin.length !== 4 || isNaN(Number(newUser.pin))) {
      setUserError('PIN must be exactly 4 digits.');
      return;
    }
    if (users.some(u => u.pin === newUser.pin)) {
      setUserError('This PIN is already in use.');
      return;
    }

    const initials = newUser.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);

    const defaultAvail: Record<DayOfWeek, DailyAvailability> = {} as any;
    DAYS_OF_WEEK.forEach(day => {
      const isWeekend = day === 'Saturday' || day === 'Sunday';
      defaultAvail[day] = {
        active: !isWeekend,
        start: '09:00',
        end: '17:00'
      };
    });

    const user: User = {
      id: `u-${Date.now()}`,
      name: newUser.name,
      role: newUser.role,
      primaryDepartment: Department.Production, // Default to Production
      avatarInitials: initials,
      pin: newUser.pin,
      availability: defaultAvail,
      lateDays: 0,
      correctionNotes: ''
    };

    onAddUser(user);
    setNewUser({ name: '', role: '', pin: '' });
    setUserError('');
    alert(`User ${user.name} created successfully!`);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
          <div className="p-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
            <h3 className="text-lg font-semibold text-zinc-800 flex items-center gap-2">
              <Settings className="w-5 h-5 text-zinc-600" />
              System Settings
            </h3>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">

            {/* PAY PERIOD SECTION */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2">
                <Calendar className="w-4 h-4 text-zinc-900" /> Pay Period Configuration
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 mb-2">Frequency</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(['Weekly', 'Bi-Weekly', 'Monthly'] as PayFrequency[]).map((freq) => (
                      <button
                        key={freq}
                        onClick={() => onUpdateSettings({ ...settings, payFrequency: freq })}
                        className={`relative p-2 rounded-lg border text-xs font-medium transition-all text-center
                          ${settings.payFrequency === freq
                            ? 'bg-zinc-50 border-zinc-300 text-zinc-800 shadow-sm'
                            : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}
                      >
                        {freq}
                        {settings.payFrequency === freq && (
                          <div className="absolute top-1 right-1 text-zinc-900">
                            <Check className="w-2 h-2" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 mb-2">Start Day</label>
                  <select
                    value={settings.payPeriodStartDay || 'Monday'}
                    onChange={(e) => onUpdateSettings({ ...settings, payPeriodStartDay: e.target.value as DayOfWeek })}
                    className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 p-2 bg-zinc-50"
                  >
                    {DAYS_OF_WEEK.map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-400 mt-1">First day of the reporting cycle</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 mb-2">Check-in Interval</label>
                  <select
                    value={settings.checkInIntervalHours || 1}
                    onChange={(e) => onUpdateSettings({ ...settings, checkInIntervalHours: Number(e.target.value) })}
                    className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 p-2 bg-zinc-50"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(hour => (
                      <option key={hour} value={hour}>{hour} Hour{hour > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-400 mt-1">Prompt staff to log activity every X hours</p>
                </div>
              </div>
            </div>

            {/* USER MANAGEMENT SECTION */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2">
                <Users className="w-4 h-4 text-zinc-900" /> Team Management
              </h4>

              <form onSubmit={handleCreateUser} className="bg-zinc-50 p-5 rounded-lg border border-zinc-200 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <UserPlus className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-semibold text-zinc-700">Add New Team Member</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                      placeholder="e.g. John Doe"
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Focus Area</label>
                    <input
                      type="text"
                      value={newUser.role}
                      onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                      placeholder="e.g. Printer"
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">4-Digit PIN</label>
                    <input
                      type="text"
                      maxLength={4}
                      value={newUser.pin}
                      onChange={e => setNewUser({ ...newUser, pin: e.target.value.replace(/\D/g, '') })}
                      placeholder="####"
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500 font-mono tracking-widest"
                    />
                  </div>
                </div>
                {userError && <p className="text-xs text-red-600 font-medium">{userError}</p>}
                <button
                  type="submit"
                  className="w-full bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold py-2 px-4 rounded-md transition-colors"
                >
                  Create User & Generate ID
                </button>
              </form>

              {/* Simple User List */}
              <div className="mt-4">
                <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase">Existing Team Members ({users.length})</p>
                <div className="max-h-[600px] overflow-y-auto border border-zinc-200 rounded-md bg-white divide-y divide-zinc-100 scrollbar-thin scrollbar-thumb-zinc-300">
                  {users.map(u => (
                    <div key={u.id} className="px-4 py-2 flex justify-between items-center text-sm group hover:bg-zinc-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center font-bold text-xs">
                          {u.avatarInitials}
                        </div>
                        <div>
                          <div className="font-medium text-zinc-800">{u.name}</div>
                          <div className="text-xs text-zinc-500">{u.role}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono bg-zinc-100 px-2 py-0.5 rounded text-xs text-zinc-500">PIN: {u.pin}</span>
                        <button
                          onClick={() => setEditingUser(u)}
                          className="flex items-center gap-1 text-xs bg-white border border-zinc-200 hover:border-zinc-300 text-zinc-600 hover:text-zinc-600 px-2 py-1 rounded transition-all shadow-sm"
                        >
                          <UserCog className="w-3 h-3" />
                          Profile
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete ${u.name}? This cannot be undone.`)) {
                              onDeleteUser(u.id);
                            }
                          }}
                          className="p-1 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2">
                <Database className="w-4 h-4 text-red-600" /> Data Management
              </h4>
              <div className="bg-white p-4 rounded-lg border border-red-100">
                <p className="text-sm text-zinc-600 mb-3">
                  Clear all local data including active sessions, user accounts, and settings. This cannot be undone.
                </p>
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to reset the application? All data will be lost.')) {
                      localStorage.clear();
                      window.location.reload();
                    }
                  }}
                  className="text-sm bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50 hover:border-red-300 transition-colors font-medium"
                >
                  Reset Application Data
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2">
                <Info className="w-4 h-4 text-zinc-600" /> System Info
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm text-zinc-600">
                <div className="bg-zinc-50 p-3 rounded-lg">
                  <span className="block text-xs text-zinc-400 uppercase">Version</span>
                  <span className="font-semibold">1.1.0 (Beta)</span>
                </div>
                <div className="bg-zinc-50 p-3 rounded-lg">
                  <span className="block text-xs text-zinc-400 uppercase">AI Service</span>
                  <span className="flex items-center gap-1 font-semibold text-zinc-900">
                    <div className="w-2 h-2 rounded-full bg-zinc-500"></div> Connected
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-zinc-300 rounded-md text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Profile Dialog */}
      <UserProfileDialog
        isOpen={!!editingUser}
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSave={onUpdateUser}
        isViewerAdmin={true}
      />
    </>
  );
};