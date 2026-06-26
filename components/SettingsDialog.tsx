import React, { useState } from 'react';
import { X, Settings, Cloud, Info, UserPlus, Users, Calendar, Check, UserCog, Trash2 } from 'lucide-react';
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
  currentUser?: User | null;
}

export const SettingsDialog: React.FC<Props> = ({ isOpen, onClose, users, onAddUser, onUpdateUser, onDeleteUser, settings, onUpdateSettings, currentUser = null }) => {
  const [newUser, setNewUser] = useState({ name: '', role: '', pin: '', username: '', password: '' });
  const [userError, setUserError] = useState('');

  // Profile Dialog State
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const handleToggleCustomCycles = (checked: boolean) => {
    const updates: Partial<AppSettings> = { useCustomPayPeriods: checked };
    if (checked) {
      if (!settings.customCycleStart) {
        const today = new Date();
        const startStr = today.toISOString().split('T')[0];
        updates.customCycleStart = startStr;
      }
      if (!settings.customCycleEnd) {
        const start = settings.customCycleStart || new Date().toISOString().split('T')[0];
        const startDateObj = new Date(start + 'T00:00:00');
        const end = new Date(startDateObj.getTime() + 13 * 24 * 60 * 60 * 1000);
        updates.customCycleEnd = end.toISOString().split('T')[0];
      }
    }
    onUpdateSettings({ ...settings, ...updates });
  };

  const getPreviewPeriods = () => {
    if (!settings.customCycleStart || !settings.customCycleEnd) return [];
    
    const periods = [];
    const today = new Date();
    const anchorStart = new Date(settings.customCycleStart + 'T00:00:00');
    const anchorEnd = new Date(settings.customCycleEnd + 'T23:59:59.999');
    
    const D_ms = anchorEnd.getTime() - anchorStart.getTime() + 1;
    const D_days = Math.round(D_ms / (24 * 60 * 60 * 1000));
    
    if (D_days > 0) {
      const todayMs = today.getTime();
      const elapsedMs = todayMs - anchorStart.getTime();
      const elapsedCycles = Math.floor(elapsedMs / D_ms);
      
      // Generate 5 preview cycles: 1 past, 1 current, 3 future
      for (let i = -1; i <= 3; i++) {
        const cycleIndex = elapsedCycles + i;
        const start = new Date(anchorStart.getTime() + cycleIndex * D_ms);
        const end = new Date(start.getTime() + D_ms - 1);
        const isCurrent = todayMs >= start.getTime() && todayMs <= end.getTime();
        
        periods.push({
          start,
          end,
          label: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
          isCurrent,
          status: isCurrent ? 'Current Cycle' : cycleIndex < elapsedCycles ? 'Past Cycle' : 'Upcoming Cycle'
        });
      }
    }
    return periods;
  };

  if (!isOpen) return null;

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.role || !newUser.pin) {
      setUserError('Name, Role, and PIN are required.');
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
    if (newUser.username && users.some(u => u.username?.toLowerCase() === newUser.username.toLowerCase())) {
      setUserError('This Username is already in use.');
      return;
    }

    const initials = newUser.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);

    const user: User = {
      id: `u-${Date.now()}`,
      name: newUser.name,
      role: newUser.role,
      username: newUser.username || undefined,
      password: newUser.password || undefined,
      primaryDepartment: Department.Production, // Default to Production
      avatarInitials: initials,
      pin: newUser.pin,
      recurringUnavailability: [],
      dateUnavailability: [],
      lateDays: 0,
      correctionNotes: ''
    };

    onAddUser(user);
    setNewUser({ name: '', role: '', pin: '', username: '', password: '' });
    setUserError('');
    alert(`User ${user.name} created successfully!`);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-xl shadow-2xl w-[95vw] max-w-7xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
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

              {/* Custom Cycles Toggle Switch */}
              <div className="flex items-center justify-between bg-zinc-50 p-4 rounded-lg border border-zinc-200">
                <div>
                  <h5 className="text-sm font-bold text-zinc-800">Use Custom Cycles</h5>
                  <p className="text-xs text-zinc-500 mt-1">
                    Set a custom start/end date for your cycle. Subsequent cycles will automatically propagate when previous ones finish.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.useCustomPayPeriods === true}
                    onChange={(e) => handleToggleCustomCycles(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-zinc-900"></div>
                </label>
              </div>

              {settings.useCustomPayPeriods ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white p-5 rounded-xl border border-zinc-200">
                  {/* Left: Configuration Form */}
                  <div className="lg:col-span-5 space-y-4 border-b lg:border-b-0 lg:border-r border-zinc-200 pb-6 lg:pb-0 lg:pr-6">
                    <h5 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Anchor Cycle</h5>
                    <p className="text-xs text-zinc-500">
                      Configure your initial/starting cycle. The system will use its duration to project all subsequent intervals.
                    </p>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 mb-1">Anchor Start Date</label>
                      <input
                        type="date"
                        value={settings.customCycleStart || ''}
                        onChange={(e) => onUpdateSettings({ ...settings, customCycleStart: e.target.value })}
                        className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 p-2 bg-zinc-50 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 mb-1">Anchor End Date</label>
                      <input
                        type="date"
                        value={settings.customCycleEnd || ''}
                        onChange={(e) => onUpdateSettings({ ...settings, customCycleEnd: e.target.value })}
                        className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 p-2 bg-zinc-50 font-medium"
                      />
                    </div>
                    {settings.customCycleStart && settings.customCycleEnd && (
                      <div className="bg-zinc-50 p-3 rounded-lg text-xs text-zinc-600 flex justify-between items-center border border-zinc-200">
                        <span className="font-medium">Calculated Cycle Length:</span>
                        <span className="font-bold text-zinc-900">
                          {Math.round(
                            (new Date(settings.customCycleEnd + 'T23:59:59.999').getTime() -
                              new Date(settings.customCycleStart + 'T00:00:00').getTime() + 1) /
                              (24 * 60 * 60 * 1000)
                          )}{' '}
                          Days
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right: Preview List */}
                  <div className="lg:col-span-7 space-y-4">
                    <h5 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Generated Cycles Preview</h5>
                    <p className="text-xs text-zinc-500">
                      Subsequent pay cycles will automatically generate as previous ones finish:
                    </p>
                    <div className="border border-zinc-200 rounded-lg overflow-hidden divide-y divide-zinc-100 max-h-[200px] overflow-y-auto bg-zinc-50/30">
                      {getPreviewPeriods().map((p, idx) => (
                        <div
                          key={idx}
                          className={`p-3 text-xs flex justify-between items-center transition-colors ${
                            p.isCurrent ? 'bg-zinc-900/5 font-semibold text-zinc-900' : 'text-zinc-600'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {p.isCurrent && <div className="w-2 h-2 rounded-full bg-zinc-900 animate-pulse"></div>}
                            <span>{p.label}</span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              p.isCurrent
                                ? 'bg-zinc-900 text-white shadow-sm'
                                : p.status === 'Past Cycle'
                                ? 'bg-zinc-100 text-zinc-400 border border-zinc-200/50'
                                : 'bg-green-50 text-green-700 border border-green-200 shadow-sm'
                            }`}
                          >
                            {p.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
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
              )}

              <div className="mt-4 flex items-center justify-between bg-zinc-50 p-4 rounded-lg border border-zinc-200">
                <div>
                  <h5 className="text-sm font-bold text-zinc-800">Discord Notifications</h5>
                  <p className="text-xs text-zinc-500 mt-1">Send warnings to Discord when staff miss check-ins.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.discordNotificationsEnabled !== false}
                    onChange={(e) => onUpdateSettings({ ...settings, discordNotificationsEnabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-zinc-900"></div>
                </label>
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Web Username (Optional)</label>
                    <input
                      type="text"
                      value={newUser.username}
                      onChange={e => setNewUser({ ...newUser, username: e.target.value.replace(/\s/g, '') })}
                      placeholder="johndoe"
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Web Password (Optional)</label>
                    <input
                      type="text"
                      value={newUser.password}
                      onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                      placeholder="password123"
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
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

              {/* User Grid */}
              <div className="mt-8">
                <p className="text-xs font-semibold text-zinc-500 mb-4 uppercase">Existing Team Members ({users.length})</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 max-h-[600px] overflow-y-auto p-1">
                  {users.map(u => (
                    <div key={u.id} className="flex flex-col bg-white p-5 rounded-2xl border border-zinc-200 hover:border-zinc-300 hover:shadow-lg transition-all group">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center font-bold text-lg">
                            {u.avatarInitials}
                          </div>
                          <div>
                            <div className="font-bold text-zinc-900">{u.name}</div>
                            <div className="text-xs text-zinc-500 font-medium">{u.role}</div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-zinc-100">
                        <span className="font-mono bg-zinc-100 px-2.5 py-1 rounded-md text-xs text-zinc-600 font-bold">PIN: {u.pin}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingUser(u)}
                            className="flex items-center gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-1.5 rounded-lg transition-colors shadow-sm font-bold"
                          >
                            <UserCog className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete ${u.name}? This cannot be undone.`)) {
                                onDeleteUser(u.id);
                              }
                            }}
                            className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete User"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
        viewerUser={currentUser}
        users={users}
      />
    </>
  );
};