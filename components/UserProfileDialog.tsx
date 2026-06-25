import React, { useState, useEffect, useRef } from 'react';
import { X, User as UserIcon, Phone, Mail, MapPin, Briefcase, Clock, AlertTriangle, Save, MessageSquare, Lock, Check, FileText, Download, ChevronDown, ChevronUp, Shield, Target, Key, DollarSign } from 'lucide-react';
import { User, DayOfWeek, DailyAvailability, Department } from '../types';
import { AVAILABLE_PERMISSIONS } from '../constants';

interface Props {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedUser: User) => void;
  isViewerAdmin?: boolean;
  viewerUser?: User | null;
}

const ORDERED_DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const generateTimeOptions = () => {
  const times = [];
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 60; j += 30) {
      const h = i.toString().padStart(2, '0');
      const m = j.toString().padStart(2, '0');
      const displayH = i === 0 ? 12 : i > 12 ? i - 12 : i;
      const ampm = i < 12 ? 'AM' : 'PM';
      times.push({
        value: `${h}:${m}`,
        label: `${displayH}:${m} ${ampm}`
      });
    }
  }
  return times;
};

const TIME_OPTIONS = generateTimeOptions();

const getMigratedUnavailability = (user: User) => {
  if (user.recurringUnavailability) {
    return {
      recurringUnavailability: user.recurringUnavailability,
      dateUnavailability: user.dateUnavailability || []
    };
  }

  const recurring: Array<{ day: DayOfWeek; allDay: boolean; start?: string; end?: string }> = [];
  if (user.availability) {
    Object.entries(user.availability).forEach(([day, dailyAvail]) => {
      if (!dailyAvail.active) {
        recurring.push({
          day: day as DayOfWeek,
          allDay: true
        });
      }
    });
  }

  return {
    recurringUnavailability: recurring,
    dateUnavailability: user.dateUnavailability || []
  };
};

export const UserProfileDialog: React.FC<Props> = ({ user, isOpen, onClose, onSave, isViewerAdmin = false, viewerUser = null }) => {
  const [formData, setFormData] = useState<User | null>(null);
  const [showPermsDropdown, setShowPermsDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [newDateBlock, setNewDateBlock] = useState({
    date: '',
    allDay: true,
    start: '09:00',
    end: '17:00'
  });

  const viewerPerms = React.useMemo(() => {
    if (!viewerUser) {
      return isViewerAdmin ? ['admin'] : [];
    }
    if (Array.isArray(viewerUser.permissions)) return viewerUser.permissions;
    if (typeof viewerUser.permissions === 'string') return (viewerUser.permissions as string).split(',').map(s => s.trim());
    return [];
  }, [viewerUser, isViewerAdmin]);

  const viewerHasPermission = (permId: string) => {
    const isViewerAdminUser = viewerUser?.role?.toLowerCase() === 'admin' || viewerPerms.includes('admin') || isViewerAdmin;
    if (isViewerAdminUser) return true;
    return viewerPerms.includes(permId);
  };

  const canEditPermissions = viewerHasPermission('manage_permissions');

  useEffect(() => {
    if (user) {
      const migrated = getMigratedUnavailability(user);
      setFormData({
        ...user,
        recurringUnavailability: migrated.recurringUnavailability,
        dateUnavailability: migrated.dateUnavailability
      });
    }
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPermsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen || !formData) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData) {
      onSave(formData);
      onClose();
    }
  };

  const handleWeeklyBlockToggle = (day: DayOfWeek, checked: boolean) => {
    if (!formData) return;
    setFormData(prev => {
      if (!prev) return null;
      const current = prev.recurringUnavailability || [];
      let next;
      if (checked) {
        next = [...current, { day, allDay: true, start: '09:00', end: '17:00' }];
      } else {
        next = current.filter(item => item.day !== day);
      }
      return {
        ...prev,
        recurringUnavailability: next
      };
    });
  };

  const handleWeeklyAllDayToggle = (day: DayOfWeek, allDay: boolean) => {
    if (!formData) return;
    setFormData(prev => {
      if (!prev) return null;
      const current = prev.recurringUnavailability || [];
      const next = current.map(item => {
        if (item.day === day) {
          return { ...item, allDay };
        }
        return item;
      });
      return {
        ...prev,
        recurringUnavailability: next
      };
    });
  };

  const handleWeeklyTimeChange = (day: DayOfWeek, field: 'start' | 'end', value: string) => {
    if (!formData) return;
    setFormData(prev => {
      if (!prev) return null;
      const current = prev.recurringUnavailability || [];
      const next = current.map(item => {
        if (item.day === day) {
          return { ...item, [field]: value };
        }
        return item;
      });
      return {
        ...prev,
        recurringUnavailability: next
      };
    });
  };

  const handleAddDateBlock = () => {
    if (!formData || !newDateBlock.date) return;
    const current = formData.dateUnavailability || [];
    if (current.some(item => item.date === newDateBlock.date)) {
      alert('This date exception is already configured.');
      return;
    }
    setFormData(prev => {
      if (!prev) return null;
      const updatedList = [...(prev.dateUnavailability || []), {
        date: newDateBlock.date,
        allDay: newDateBlock.allDay,
        start: newDateBlock.allDay ? undefined : newDateBlock.start,
        end: newDateBlock.allDay ? undefined : newDateBlock.end
      }];
      updatedList.sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...prev,
        dateUnavailability: updatedList
      };
    });
    setNewDateBlock({
      date: '',
      allDay: true,
      start: '09:00',
      end: '17:00'
    });
  };

  const handleRemoveDateBlock = (indexToRemove: number) => {
    if (!formData) return;
    setFormData(prev => {
      if (!prev) return null;
      const current = prev.dateUnavailability || [];
      return {
        ...prev,
        dateUnavailability: current.filter((_, idx) => idx !== indexToRemove)
      };
    });
  };

  const togglePermission = (permId: string) => {
    if (!formData) return;

    // Safely parse permissions since external databases might return stringified JSON or CSVs
    let currentPerms: string[] = [];
    const rawPerms = formData.permissions as any;
    if (Array.isArray(rawPerms)) {
      currentPerms = rawPerms;
    } else if (typeof rawPerms === 'string') {
      try {
        const parsed = JSON.parse(rawPerms);
        currentPerms = Array.isArray(parsed) ? parsed : [rawPerms];
      } catch {
        currentPerms = rawPerms.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }

    let newPerms: string[];
    let newRole = formData.role;

    if (currentPerms.includes(permId)) {
      newPerms = currentPerms.filter(p => p !== permId);

      // If revoking admin/manager via checkbox, actively strip it from their role
      if (permId === 'admin' && newRole.toLowerCase() === 'admin') {
        newRole = 'Staff';
      } else if (permId === 'manage_users' && newRole.toLowerCase() === 'manager') {
        newRole = 'Staff';
      }
    } else {
      newPerms = [...currentPerms, permId];

      // If granting admin/manager via checkbox, force their active role text
      if (permId === 'admin') {
        newRole = 'admin';
      } else if (permId === 'manage_users' && newRole.toLowerCase() !== 'admin') {
        newRole = 'manager';
      }
    }

    setFormData({ ...formData, permissions: newPerms, role: newRole });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] max-w-7xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
        <div className="bg-gradient-to-r from-zinc-900 to-zinc-700 p-6 text-white flex justify-between items-start">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-2xl font-bold border-2 border-white/30">
              {formData.avatarInitials}
            </div>
            <div>
              <h3 className="text-xl font-bold">{formData.name}</h3>
              <p className="text-zinc-100 text-sm">{formData.role}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Split Top Layout: Left = Personal Information, Right = Work Information */}
          <div className={`grid grid-cols-1 ${viewerHasPermission('manage_users') ? 'lg:grid-cols-2' : ''} gap-8`}>
            {/* Personal Information */}
            <section className="space-y-4">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2">
                <UserIcon className="w-4 h-4 text-zinc-500" /> Personal Information
              </h4>
              <div className="space-y-3 pl-6">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Full Name</label>
                  <div className="input-icon-wrapper">
                    <UserIcon className="text-zinc-400" />
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full pl-10 text-sm border border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Phone Number</label>
                  <div className="input-icon-wrapper">
                    <Phone className="text-zinc-400" />
                    <input
                      type="tel"
                      value={formData.phoneNumber || ''}
                      onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })}
                      placeholder="(555) 000-0000"
                      className="w-full pl-10 text-sm border border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Email Address</label>
                  <div className="input-icon-wrapper">
                    <Mail className="text-zinc-400" />
                    <input
                      type="email"
                      value={formData.email || ''}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@company.com"
                      className="w-full pl-10 text-sm border border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Mailing Address</label>
                  <div className="input-icon-wrapper">
                    <MapPin className="text-zinc-400" />
                    <input
                      type="text"
                      value={formData.address || ''}
                      onChange={e => setFormData({ ...formData, address: e.target.value })}
                      placeholder="123 Street Name, City, State"
                      className="w-full pl-10 text-sm border border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Discord ID (for notifications)</label>
                  <div className="input-icon-wrapper">
                    <MessageSquare className="text-zinc-400" />
                    <input
                      type="text"
                      value={formData.discordId || ''}
                      onChange={e => setFormData({ ...formData, discordId: e.target.value })}
                      placeholder="e.g. 123456789012345678"
                      className="w-full pl-10 text-sm border border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-500"
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 bg-zinc-50 rounded-lg p-3 border border-zinc-100">
                    <div className="font-bold text-zinc-700 mb-1">How to find your Discord ID on Mobile:</div>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Open Discord & tap your profile icon (bottom right).</li>
                      <li>Go to <strong>Settings</strong> (gear icon) <span className="text-zinc-400">→</span> <strong>Advanced</strong>.</li>
                      <li>Turn on <strong>Developer Mode</strong>.</li>
                      <li>Go back to your Profile.</li>
                      <li>Tap the three dots (top right) and select <strong>Copy User ID</strong>.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </section>

            {/* Work Information - Only visible to authorized viewers */}
            {viewerHasPermission('manage_users') && (
              <section className="space-y-4">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2">
                  <Briefcase className="w-4 h-4 text-zinc-500" /> Work Information
                </h4>
                <div className="space-y-3 pl-6">
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Primary Department</label>
                    <select
                      value={formData.primaryDepartment || ''}
                      onChange={e => setFormData({ ...formData, primaryDepartment: e.target.value as Department })}
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-zinc-50"
                    >
                      <option value="" disabled>Select Department</option>
                      {Object.values(Department).map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Focus Area (System Role)</label>
                    <input
                      type="text"
                      value={formData.role}
                      onChange={e => {
                        const val = e.target.value;
                        let currentPerms: string[] = [];
                        const rawPerms = formData.permissions as any;
                        if (Array.isArray(rawPerms)) {
                          currentPerms = rawPerms;
                        } else if (typeof rawPerms === 'string') {
                          try {
                            const parsed = JSON.parse(rawPerms);
                            currentPerms = Array.isArray(parsed) ? parsed : [rawPerms];
                          } catch {
                            currentPerms = rawPerms.split(',').map(s => s.trim()).filter(Boolean);
                          }
                        }
                        let perms = [...currentPerms];
                        if (val.toLowerCase() === 'admin') {
                          perms = AVAILABLE_PERMISSIONS.map(p => p.id);
                        } else if (val.toLowerCase() === 'manager') {
                          const managerPerms = ['manage_users', 'edit_timecards', 'approve_timecards', 'manage_schedule', 'create_tasks', 'view_reports', 'view_payroll'];
                          perms = Array.from(new Set([...perms.filter(p => p !== 'admin'), ...managerPerms]));
                        } else if (val.toLowerCase() === 'staff' || val.toLowerCase() === 'terminal') {
                          perms = perms.filter(p => p === 'mobile_clock_in');
                        }
                        setFormData({ ...formData, role: val, permissions: perms });
                      }}
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-zinc-50"
                      placeholder="e.g. Production Lead, manager, admin"
                    />
                  </div>
                  {viewerHasPermission('view_payroll') && (
                    <div>
                      <label className="block text-xs font-medium text-zinc-500 mb-1">Hourly Pay Rate</label>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-zinc-400 font-medium">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.payRate || ''}
                          onChange={e => setFormData({ ...formData, payRate: parseFloat(e.target.value) || undefined })}
                          placeholder="e.g. 15.50"
                          className="w-full pl-7 text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-zinc-50"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* Remaining sections below the split top layout */}
          {viewerHasPermission('manage_users') && (
            <>
              {/* Weekly Unavailability Grid */}
              <div className="mt-4">
                <label className="block text-xs font-medium text-zinc-500 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-zinc-500" /> Weekly Unavailability (Blocked Times)
                </label>
                <div className="bg-zinc-50 rounded-lg border border-zinc-200 overflow-hidden">
                  {ORDERED_DAYS.map((day) => {
                    const isBlocked = (formData.recurringUnavailability || []).some(item => item.day === day);
                    const blockData = (formData.recurringUnavailability || []).find(item => item.day === day) || { allDay: true, start: '09:00', end: '17:00' };
                    return (
                      <div key={day} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border-b border-zinc-200 last:border-0 hover:bg-white transition-colors">
                        <div className="w-40 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isBlocked}
                            onChange={(e) => handleWeeklyBlockToggle(day, e.target.checked)}
                            className="h-4 w-4 text-zinc-900 rounded border-zinc-300 focus:ring-zinc-500"
                          />
                          <span className={`text-sm font-medium ${isBlocked ? 'text-zinc-900' : 'text-zinc-400'}`}>
                            {day} {isBlocked && <span className="text-[10px] text-red-500 font-semibold">(Blocked)</span>}
                          </span>
                        </div>

                        {isBlocked && (
                          <div className="flex-1 flex flex-wrap items-center gap-3 justify-end">
                            <div className="flex rounded-md shadow-sm" role="group">
                              <button
                                type="button"
                                onClick={() => handleWeeklyAllDayToggle(day, true)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded-l-md border ${
                                  blockData.allDay
                                    ? 'bg-zinc-900 text-white border-zinc-900'
                                    : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                                }`}
                              >
                                All Day
                              </button>
                              <button
                                type="button"
                                onClick={() => handleWeeklyAllDayToggle(day, false)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded-r-md border-t border-b border-r ${
                                  !blockData.allDay
                                    ? 'bg-zinc-900 text-white border-zinc-900'
                                    : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                                }`}
                              >
                                Custom Hours
                              </button>
                            </div>

                            {!blockData.allDay && (
                              <div className="flex items-center gap-1.5 min-w-[200px]">
                                <select
                                  value={blockData.start || '09:00'}
                                  onChange={(e) => handleWeeklyTimeChange(day, 'start', e.target.value)}
                                  className="block w-full text-xs border-zinc-300 rounded-md shadow-sm focus:ring-zinc-500 focus:border-zinc-300"
                                >
                                  {TIME_OPTIONS.map(t => (
                                    <option key={`start-${day}-${t.value}`} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                                <span className="text-zinc-400">-</span>
                                <select
                                  value={blockData.end || '17:00'}
                                  onChange={(e) => handleWeeklyTimeChange(day, 'end', e.target.value)}
                                  className="block w-full text-xs border-zinc-300 rounded-md shadow-sm focus:ring-zinc-500 focus:border-zinc-300"
                                >
                                  {TIME_OPTIONS.map(t => (
                                    <option key={`end-${day}-${t.value}`} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Date-Specific Unavailability */}
              <div className="mt-4">
                <label className="block text-xs font-medium text-zinc-500 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-zinc-500" /> Date-Specific Unavailability Exceptions
                </label>
                <div className="bg-white rounded-lg border border-zinc-200 p-4 space-y-3">
                  {(formData.dateUnavailability || []).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {(formData.dateUnavailability || []).map((block, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 rounded-lg px-3 py-1.5 transition-colors">
                          <span className="text-xs font-semibold text-zinc-700">{block.date}</span>
                          <span className="text-[10px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded font-medium">
                            {block.allDay ? 'All Day' : `${block.start} - ${block.end}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveDateBlock(idx)}
                            className="text-zinc-400 hover:text-zinc-600 focus:outline-none"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 italic">No date-specific unavailability exceptions set.</p>
                  )}

                  <div className="border-t border-zinc-100 pt-3">
                    <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                      <div>
                        <label className="block text-[10px] font-medium text-zinc-500 mb-1">Select Date</label>
                        <input
                          type="date"
                          value={newDateBlock.date}
                          onChange={(e) => setNewDateBlock(prev => ({ ...prev, date: e.target.value }))}
                          className="block w-full text-xs border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-white"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-[10px] font-medium text-zinc-500 mb-1">Duration</label>
                        <div className="flex rounded-md shadow-sm h-8" role="group">
                          <button
                            type="button"
                            onClick={() => setNewDateBlock(prev => ({ ...prev, allDay: true }))}
                            className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-l-md border ${
                              newDateBlock.allDay
                                ? 'bg-zinc-900 text-white border-zinc-900'
                                : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                            }`}
                          >
                            All Day
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewDateBlock(prev => ({ ...prev, allDay: false }))}
                            className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-r-md border-t border-b border-r ${
                              !newDateBlock.allDay
                                ? 'bg-zinc-900 text-white border-zinc-900'
                                : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                            }`}
                          >
                            Custom Hours
                          </button>
                        </div>
                      </div>

                      <div className={`flex items-center gap-1.5 ${newDateBlock.allDay ? 'opacity-30 pointer-events-none' : ''}`}>
                        <div className="flex-1">
                          <label className="block text-[10px] font-medium text-zinc-500 mb-1">Start Time</label>
                          <select
                            disabled={newDateBlock.allDay}
                            value={newDateBlock.start}
                            onChange={(e) => setNewDateBlock(prev => ({ ...prev, start: e.target.value }))}
                            className="block w-full text-xs border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-white"
                          >
                            {TIME_OPTIONS.map(t => (
                              <option key={`new-start-${t.value}`} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <span className="text-zinc-400 mt-5">-</span>
                        <div className="flex-1">
                          <label className="block text-[10px] font-medium text-zinc-500 mb-1">End Time</label>
                          <select
                            disabled={newDateBlock.allDay}
                            value={newDateBlock.end}
                            onChange={(e) => setNewDateBlock(prev => ({ ...prev, end: e.target.value }))}
                            className="block w-full text-xs border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-white"
                          >
                            {TIME_OPTIONS.map(t => (
                              <option key={`new-end-${t.value}`} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <button
                          type="button"
                          onClick={handleAddDateBlock}
                          disabled={!newDateBlock.date}
                          className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 px-3 rounded-md transition-colors h-8 flex items-center justify-center"
                        >
                          + Add Blocked Date
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Correction Review Section */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-2 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-zinc-500" /> Correction Reviews
                </label>
                <textarea
                  value={formData.correctionNotes || ''}
                  onChange={e => setFormData({ ...formData, correctionNotes: e.target.value })}
                  placeholder="Log any disciplinary actions, performance corrections, or time card adjustments here..."
                  rows={4}
                  className="w-full text-sm border-zinc-300 rounded-md shadow-sm focus:ring-zinc-500 focus:border-zinc-500 p-3 bg-yellow-50/50"
                />
              </div>

              {/* Submitted Documents Section */}
              <div className="pt-4 border-t border-zinc-100">
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-500" /> Submitted Onboarding Documents
                </label>
                {formData.onboardingDocuments && formData.onboardingDocuments.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {formData.onboardingDocuments.map(doc => (
                      <a
                        key={doc.id}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-white border border-zinc-200 rounded-lg shadow-sm hover:border-zinc-300 hover:shadow-md transition-all group"
                      >
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-zinc-900 truncate">
                            {doc.formType === 'w9' ? 'W-9 Form' : 'Direct Deposit'}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {new Date(doc.uploadedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <Download className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="bg-zinc-50 border border-zinc-100 rounded-lg p-4 text-center text-sm text-zinc-500 italic">
                    No documents submitted yet.
                  </div>
                )}
              </div>

              {/* Bio-Lock Permissions Section */}
              <section className="space-y-2 relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowPermsDropdown(!showPermsDropdown)}
                  className="w-full flex items-center justify-between border-b border-zinc-100 pb-2 text-left hover:opacity-85 transition-all"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Lock className="w-4 h-4 text-red-500 shrink-0" />
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0">Bio-Lock Permissions</span>
                  </div>
                  {showPermsDropdown ? <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
                </button>

                {showPermsDropdown && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl max-h-96 overflow-y-auto p-4 space-y-4 z-[70]">
                    {['Administration', 'Team Management', 'Time & Attendance', 'Operations', 'Reporting'].map(category => {
                      const catPerms = AVAILABLE_PERMISSIONS.filter(p => p.category === category);
                      if (catPerms.length === 0) return null;

                      return (
                        <div key={category} className="space-y-2">
                          <h5 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mt-4 first:mt-0">
                            {category}
                          </h5>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {catPerms.map(perm => {
                              let isSelected = false;
                              const rawPerms = formData.permissions as any;
                              if (Array.isArray(rawPerms)) {
                                isSelected = rawPerms.includes(perm.id);
                              } else if (typeof rawPerms === 'string') {
                                isSelected = rawPerms.includes(perm.id);
                              }

                              return (
                                <div
                                  key={perm.id}
                                  onClick={() => {
                                    if (canEditPermissions) {
                                      togglePermission(perm.id);
                                    }
                                  }}
                                  className={`
                                    p-3 rounded-lg border text-left transition-all relative group/item
                                    ${canEditPermissions ? 'cursor-pointer hover:bg-zinc-100' : 'opacity-70 cursor-not-allowed'}
                                    ${isSelected
                                      ? 'bg-red-50/70 border-red-200 shadow-sm'
                                      : 'bg-zinc-50 border-transparent'}
                                  `}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className={`
                                      w-5 h-5 rounded flex items-center justify-center border mt-0.5 transition-colors shrink-0
                                      ${isSelected
                                        ? 'bg-red-500 border-red-500 text-white'
                                        : 'bg-white border-zinc-300'}
                                    `}>
                                      {isSelected && <Check className="w-3 h-3" />}
                                    </div>
                                    <div className="flex-1">
                                      <h5 className={`text-sm font-semibold ${isSelected ? 'text-red-700' : 'text-zinc-700'}`}>
                                        {perm.label}
                                      </h5>
                                      <p className="text-xs text-zinc-500 leading-tight mt-0.5">
                                        {perm.description}
                                      </p>
                                      {perm.detailedExplanation && (
                                        <div className="mt-1.5 text-[10px] text-zinc-400 border-t border-zinc-200/40 pt-1 leading-normal">
                                          {perm.detailedExplanation}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          <div className="pt-4 sticky bottom-0 bg-white">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all active:scale-95"
            >
              <Save className="w-4 h-4" />
              Save Profile Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};