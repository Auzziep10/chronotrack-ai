import React, { useState, useEffect } from 'react';
import { X, User as UserIcon, Phone, Mail, MapPin, Briefcase, Clock, AlertTriangle, Save, MessageSquare, Lock, Check } from 'lucide-react';
import { User, DayOfWeek, DailyAvailability, Department } from '../types';
import { AVAILABLE_PERMISSIONS } from '../constants';

interface Props {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedUser: User) => void;
  isViewerAdmin?: boolean;
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

export const UserProfileDialog: React.FC<Props> = ({ user, isOpen, onClose, onSave, isViewerAdmin = false }) => {
  const [formData, setFormData] = useState<User | null>(null);

  useEffect(() => {
    if (user) {
      setFormData({ ...user });
    }
  }, [user]);

  if (!isOpen || !formData) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData) {
      onSave(formData);
      onClose();
    }
  };

  const handleAvailabilityChange = (day: DayOfWeek, field: keyof DailyAvailability, value: any) => {
    if (!formData) return;
    setFormData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        availability: {
          ...prev.availability,
          [day]: {
            ...prev.availability[day],
            [field]: value
          }
        }
      };
    });
  };

  const togglePermission = (permId: string) => {
    if (!formData) return;

    // Safely parse permissions since external databases might return stringified JSON or CSVs
    let currentPerms: string[] = [];
    if (Array.isArray(formData.permissions)) {
      currentPerms = formData.permissions;
    } else if (typeof formData.permissions === 'string') {
      try {
        const parsed = JSON.parse(formData.permissions);
        currentPerms = Array.isArray(parsed) ? parsed : [formData.permissions];
      } catch {
        currentPerms = formData.permissions.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    let newPerms: string[];
    let newRole = formData.role;

    if (currentPerms.includes(permId)) {
      newPerms = currentPerms.filter(p => p !== permId);

      // If revoking admin/manager via checkbox, actively strip it from their role
      if (permId === 'admin' && newRole.toLowerCase() === 'admin') {
        newRole = 'Staff';
      } else if (permId === 'manage_team' && newRole.toLowerCase() === 'manager') {
        newRole = 'Staff';
      }
    } else {
      newPerms = [...currentPerms, permId];

      // If granting admin/manager via checkbox, force their active role text
      if (permId === 'admin') {
        newRole = 'admin';
      } else if (permId === 'manage_team' && newRole.toLowerCase() !== 'admin') {
        newRole = 'manager';
      }
    }

    setFormData({ ...formData, permissions: newPerms, role: newRole });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white flex justify-between items-start">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-2xl font-bold border-2 border-white/30">
              {formData.avatarInitials}
            </div>
            <div>
              <h3 className="text-xl font-bold">{formData.name}</h3>
              <p className="text-blue-100 text-sm">{formData.role}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* Work Information - Only visible to admins */}
          {isViewerAdmin && (
            <section className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
                <Briefcase className="w-4 h-4 text-blue-500" /> Work Information
              </h4>

              <div className="grid grid-cols-2 gap-4">
                {/* Row 1: Primary Dept & Primary Role */}
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Primary Department</label>
                  <select
                    value={formData.primaryDepartment || ''}
                    onChange={e => setFormData({ ...formData, primaryDepartment: e.target.value as Department })}
                    className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                  >
                    <option value="" disabled>Select Department</option>
                    {Object.values(Department).map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Focus Area (System Role)</label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={e => {
                      const val = e.target.value;
                      let currentPerms: string[] = [];
                      if (Array.isArray(formData.permissions)) {
                        currentPerms = formData.permissions;
                      } else if (typeof formData.permissions === 'string') {
                        try {
                          const parsed = JSON.parse(formData.permissions);
                          currentPerms = Array.isArray(parsed) ? parsed : [formData.permissions];
                        } catch {
                          currentPerms = formData.permissions.split(',').map(s => s.trim()).filter(Boolean);
                        }
                      }
                      let perms = [...currentPerms];

                      // Auto-sync permissions array based on what they type in the role field
                      if (val.toLowerCase() === 'admin' && !perms.includes('admin')) {
                        perms.push('admin');
                      } else if (val.toLowerCase() !== 'admin' && perms.includes('admin')) {
                        perms = perms.filter(p => p !== 'admin');
                      }

                      if (val.toLowerCase() === 'manager' && !perms.includes('manage_team')) {
                        perms.push('manage_team');
                      } else if (val.toLowerCase() !== 'manager' && val.toLowerCase() !== 'admin' && perms.includes('manage_team')) {
                        perms = perms.filter(p => p !== 'manage_team');
                      }

                      setFormData({ ...formData, role: val, permissions: perms });
                    }}
                    className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                    placeholder="e.g. Production Lead, manager, admin"
                  />
                </div>

                {/* Row 2: Secondary Dept & Supporting Role */}
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Secondary Department</label>
                  <select
                    value={formData.secondaryDepartment || ''}
                    onChange={e => setFormData({ ...formData, secondaryDepartment: e.target.value as Department })}
                    className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="">None</option>
                    {Object.values(Department).map(dept => (
                      <option key={`sec-${dept}`} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Focus Area</label>
                  <input
                    type="text"
                    value={formData.supportingRole || ''}
                    onChange={e => setFormData({ ...formData, supportingRole: e.target.value })}
                    className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                    placeholder="e.g. Backup Driver"
                  />
                </div>

                {/* Row 3: PIN & Late Days */}
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Access PIN</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={formData.pin}
                    onChange={e => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
                    className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 font-mono tracking-widest bg-gray-50"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Late Days to Date</label>
                  <div className="relative">
                    <AlertTriangle className="absolute left-3 top-2.5 w-4 h-4 text-orange-400" />
                    <input
                      type="number"
                      min="0"
                      value={formData.lateDays || 0}
                      onChange={e => setFormData({ ...formData, lateDays: parseInt(e.target.value) || 0 })}
                      className="w-full pl-9 text-sm border-gray-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>

              {/* Availability Grid */}
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-500 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500" /> Weekly Availability
                </label>
                <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                  {ORDERED_DAYS.map((day) => {
                    const dayData = formData.availability[day] || { active: false, start: '09:00', end: '17:00' };
                    return (
                      <div key={day} className="flex items-center gap-3 p-3 border-b border-gray-200 last:border-0 hover:bg-white transition-colors">
                        <div className="w-28 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={dayData.active}
                            onChange={(e) => handleAvailabilityChange(day, 'active', e.target.checked)}
                            className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                          <span className={`text-sm font-medium ${dayData.active ? 'text-gray-900' : 'text-gray-400'}`}>
                            {day}
                          </span>
                        </div>

                        <div className="flex-1 flex items-center gap-2">
                          <select
                            disabled={!dayData.active}
                            value={dayData.start}
                            onChange={(e) => handleAvailabilityChange(day, 'start', e.target.value)}
                            className="block w-full text-xs border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                          >
                            {TIME_OPTIONS.map(t => (
                              <option key={`start-${day}-${t.value}`} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                          <span className="text-gray-400">-</span>
                          <select
                            disabled={!dayData.active}
                            value={dayData.end}
                            onChange={(e) => handleAvailabilityChange(day, 'end', e.target.value)}
                            className="block w-full text-xs border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                          >
                            {TIME_OPTIONS.map(t => (
                              <option key={`end-${day}-${t.value}`} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Correction Review Section */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-purple-500" /> Correction Reviews
                </label>
                <textarea
                  value={formData.correctionNotes || ''}
                  onChange={e => setFormData({ ...formData, correctionNotes: e.target.value })}
                  placeholder="Log any disciplinary actions, performance corrections, or time card adjustments here..."
                  rows={4}
                  className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 p-3 bg-yellow-50/50"
                />
              </div>
            </section>
          )}

          {/* Permissions Section - Only visible to admins */}
          {isViewerAdmin && (
            <section className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
                <Lock className="w-4 h-4 text-red-500" /> Bio-Lock Permissions
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {AVAILABLE_PERMISSIONS.map(perm => {
                  let isSelected = false;
                  if (Array.isArray(formData.permissions)) {
                    isSelected = formData.permissions.includes(perm.id);
                  } else if (typeof formData.permissions === 'string') {
                    isSelected = formData.permissions.includes(perm.id);
                  }

                  return (
                    <div
                      key={perm.id}
                      onClick={() => togglePermission(perm.id)}
                      className={`
                                      cursor-pointer p-3 rounded-lg border text-left transition-all
                                      ${isSelected
                          ? 'bg-red-50 border-red-200 shadow-sm'
                          : 'bg-gray-50 border-transparent hover:bg-gray-100'}
                                  `}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`
                                          w-5 h-5 rounded flex items-center justify-center border transition-colors
                                          ${isSelected
                            ? 'bg-red-500 border-red-500 text-white'
                            : 'bg-white border-gray-300'}
                                      `}>
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>
                        <div>
                          <h5 className={`text-sm font-semibold ${isSelected ? 'text-red-700' : 'text-gray-700'}`}>
                            {perm.label}
                          </h5>
                          <p className="text-xs text-gray-500 leading-tight mt-0.5">
                            {perm.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Personal Information */}
          <section className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
              <UserIcon className="w-4 h-4 text-green-500" /> Personal Information
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-sm border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="tel"
                    value={formData.phoneNumber || ''}
                    onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })}
                    placeholder="(555) 000-0000"
                    className="w-full pl-9 text-sm border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@company.com"
                    className="w-full pl-9 text-sm border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Mailing Address</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    placeholder="123 Street Name, City, State"
                    className="w-full pl-9 text-sm border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Discord ID (for notifications)</label>
                <div className="relative">
                  <MessageSquare className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={formData.discordId || ''}
                    onChange={e => setFormData({ ...formData, discordId: e.target.value })}
                    placeholder="e.g. 123456789012345678"
                    className="w-full pl-9 text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Requires Discord Developer Mode to copy user ID.</p>
              </div>
            </div>
          </section>

          <div className="pt-4 sticky bottom-0 bg-white">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all active:scale-95"
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