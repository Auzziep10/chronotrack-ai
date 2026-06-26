import React, { useState, useEffect, useRef } from 'react';
import { X, User as UserIcon, Phone, Mail, MapPin, Briefcase, Clock, AlertTriangle, AlertCircle, Save, MessageSquare, Lock, Check, FileText, Download, ChevronDown, ChevronUp, ChevronRight, Shield, Target, Key, DollarSign, ClipboardCheck, Calendar, ArrowUp, ArrowDown } from 'lucide-react';
import { User, DayOfWeek, DailyAvailability, Department } from '../types';
import { AVAILABLE_PERMISSIONS } from '../constants';

interface Props {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedUser: User) => void;
  isViewerAdmin?: boolean;
  viewerUser?: User | null;
  timeCards?: any[];
  users?: User[];
}

const RELIABILITY_CONFIG = {
  // Score deduction weights (base 100)
  weights: {
    noCallShow: 25,
    sickNoDoc: 8,
    sickWithDoc: 2,
    tardyPer5Min: 1, // max 10 deduction per tardy (50 mins late)
    unplannedTimeOff: 3,
    weekendHolidaySickPenalty: 5, // extra penalty for undocumented sick near weekend/holidays
  },
  // Warnings Banner thresholds (assessed over the active date range)
  thresholds: {
    noCallShows: 1,
    tardys: 3,
    undocumentedSick: 2,
    lowSampleSizeShifts: 10,
  }
};

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

const formatPhoneNumber = (value: string) => {
  if (!value) return '';
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.slice(0, 10);
  if (match.length <= 3) {
    return match;
  }
  if (match.length <= 6) {
    return `(${match.slice(0, 3)})${match.slice(3)}`;
  }
  return `(${match.slice(0, 3)})${match.slice(3, 6)}-${match.slice(6)}`;
};

export const UserProfileDialog: React.FC<Props> = ({ user, isOpen, onClose, onSave, isViewerAdmin = false, viewerUser = null, timeCards = [], users = [] }) => {
  const [formData, setFormData] = useState<User | null>(null);
  const [showPermsDropdown, setShowPermsDropdown] = useState(false);
  const [showSchedulingDropdown, setShowSchedulingDropdown] = useState(false);
  const [showReviewDropdown, setShowReviewDropdown] = useState(false);
  const [reviewRange, setReviewRange] = useState<'30' | '60' | '90' | 'yearly' | 'complete'>('30');
  const [localTimeCards, setLocalTimeCards] = useState<any[]>(timeCards || []);
  const [activeDrilldown, setActiveDrilldown] = useState<'sick' | 'timeOff' | 'noCall' | 'tardy' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (timeCards && timeCards.length > 0) {
      setLocalTimeCards(timeCards);
    } else {
      const loadTimeCards = async () => {
        try {
          const { storageService } = await import('../services/storageService');
          const localData = storageService.getAllData();
          let cards = localData.timeCards;
          
          const { firebaseGetTimeCards, isFirebaseConfigured } = await import('../services/firebaseService');
          if (isFirebaseConfigured()) {
            const remoteCards = await firebaseGetTimeCards().catch(() => []);
            if (remoteCards && remoteCards.length > 0) {
              cards = remoteCards;
            }
          }
          setLocalTimeCards(cards);
        } catch (e) {
          console.warn("Failed to load timecards in UserProfileDialog", e);
        }
      };
      loadTimeCards();
    }
  }, [timeCards]);

  const handleToggleSickDoc = (cardId: string) => {
    const updatedCards = localTimeCards.map(c => {
      if (c.id === cardId) {
        const updated = { ...c, sickDocumentationProvided: !c.sickDocumentationProvided };
        import('../services/storageService').then(mod => {
          mod.storageService.saveTimeCard(updated);
        });
        return updated;
      }
      return c;
    });
    setLocalTimeCards(updatedCards);
  };

  const handleUpdateNoCallCover = (cardId: string, coverUserId: string) => {
    const coverUser = users.find(u => u.id === coverUserId);
    const updatedCards = localTimeCards.map(c => {
      if (c.id === cardId) {
        const updated = {
          ...c,
          coveredByUserId: coverUserId || undefined,
          coveredByUserName: coverUser ? coverUser.name : undefined
        };
        import('../services/storageService').then(mod => {
          mod.storageService.saveTimeCard(updated);
        });
        return updated;
      }
      return c;
    });
    setLocalTimeCards(updatedCards);
  };

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
        phoneNumber: user.phoneNumber ? formatPhoneNumber(user.phoneNumber) : '',
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
            <section className="space-y-4 flex flex-col h-full">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2">
                <UserIcon className="w-4 h-4 text-zinc-500" /> Personal Information
              </h4>
              <div className="space-y-3 pl-6 flex-1 flex flex-col">
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
                      onChange={e => setFormData({ ...formData, phoneNumber: formatPhoneNumber(e.target.value) })}
                      placeholder="(555)000-0000"
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

                <div className="flex-1 flex flex-col">
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
                  <div className="flex-1 flex flex-col justify-end mt-4">
                    <div className="text-xs text-zinc-500 bg-zinc-50 rounded-lg p-3 border border-zinc-100">
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

                {/* Documents Section */}
                <div className="mt-10">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2 mb-3">
                    <FileText className="w-4 h-4 text-zinc-500" /> Documents
                  </h4>
                  {formData.onboardingDocuments && formData.onboardingDocuments.length > 0 ? (
                    <div className="flex flex-row gap-3 overflow-x-auto pb-2 scroll-smooth">
                      {formData.onboardingDocuments.map(doc => (
                        <a
                          key={doc.id}
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={doc.fileName || (doc.formType === 'w9' ? 'W-9 Form' : 'Direct Deposit')}
                          className="flex items-center gap-3 p-3 bg-white border border-zinc-200 rounded-lg shadow-sm hover:border-zinc-300 hover:shadow-md transition-all group flex-shrink-0 w-60"
                        >
                          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
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
                          <Download className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 shrink-0" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-zinc-50 border border-zinc-100 rounded-lg p-4 text-center text-sm text-zinc-500 italic">
                      No documents submitted yet.
                    </div>
                  )}
                </div>

                {/* Correction Reviews Section */}
                <div className="mt-6">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2 border-b border-zinc-100 pb-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-zinc-500" /> Correction Reviews
                  </h4>
                  <textarea
                    value={formData.correctionNotes || ''}
                    onChange={e => setFormData({ ...formData, correctionNotes: e.target.value })}
                    placeholder="Log any disciplinary actions, performance corrections, or time card adjustments here..."
                    rows={4}
                    className="w-full text-sm border-zinc-300 rounded-md shadow-sm focus:ring-zinc-500 focus:border-zinc-500 p-3 bg-yellow-50/50"
                  />
                </div>
              </section>
            )}
          </div>

          {/* Remaining sections below the split top layout */}
          {viewerHasPermission('manage_users') && (
            <>
              {/* Scheduling Accordion Section */}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowSchedulingDropdown(!showSchedulingDropdown)}
                  className="w-full flex items-center gap-2 border-b border-zinc-100 pb-2 text-left hover:opacity-85 transition-all"
                >
                  {showSchedulingDropdown ? (
                    <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                  )}
                  <Clock className="w-4 h-4 text-zinc-500 shrink-0" />
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0">Scheduling</span>
                </button>

                {showSchedulingDropdown && (
                  <div className="mt-4 space-y-6 bg-zinc-50/30 border border-zinc-200 rounded-lg p-4 animate-in slide-in-from-top-2 duration-200">
                    {/* Weekly Unavailability Grid */}
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Weekly Unavailability (Blocked Times)
                      </label>
                      <div className="bg-zinc-50 rounded-lg border border-zinc-200 overflow-hidden">
                        {ORDERED_DAYS.map((day) => {
                          const isBlocked = (formData.recurringUnavailability || []).some(item => item.day === day);
                          const blockData = (formData.recurringUnavailability || []).find(item => item.day === day) || { allDay: true, start: '09:00', end: '17:00' };
                          return (
                            <div key={day} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border-b border-zinc-200 last:border-0 hover:bg-white transition-colors bg-white/50">
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
                                        className="block w-full text-xs border-zinc-300 rounded-md shadow-sm focus:ring-zinc-500 focus:border-zinc-300 bg-white"
                                      >
                                        {TIME_OPTIONS.map(t => (
                                          <option key={`start-${day}-${t.value}`} value={t.value}>{t.label}</option>
                                        ))}
                                      </select>
                                      <span className="text-zinc-400">-</span>
                                      <select
                                        value={blockData.end || '17:00'}
                                        onChange={(e) => handleWeeklyTimeChange(day, 'end', e.target.value)}
                                        className="block w-full text-xs border-zinc-300 rounded-md shadow-sm focus:ring-zinc-500 focus:border-zinc-300 bg-white"
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

                    {/* Requested Time Off */}
                    <div className="space-y-2 pt-4 border-t border-zinc-200">
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Requested Time Off
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
                          <p className="text-xs text-zinc-400 italic">No requested time off exceptions set.</p>
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
                                + Add Requested Time Off
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Review Section */}
              {(() => {
                // Proximity helper
                const isNearWeekendOrHoliday = (timestamp: number) => {
                  const d = new Date(timestamp);
                  const day = d.getDay();
                  // 0 = Sun, 1 = Mon, 5 = Fri, 6 = Sat
                  if (day === 0 || day === 1 || day === 5 || day === 6) {
                    const dayNames = ['Sunday', 'Monday', 'Unknown', 'Unknown', 'Unknown', 'Friday', 'Saturday'];
                    return `Weekend (${dayNames[day]})`;
                  }
                  
                  // Basic holidays in US (simplified check by MM-DD)
                  const month = d.getMonth() + 1; // 1-12
                  const date = d.getDate();
                  const md = `${month.toString().padStart(2, '0')}-${date.toString().padStart(2, '0')}`;
                  
                  const holidays: Record<string, string> = {
                    '01-01': "New Year's Day",
                    '07-04': 'Independence Day',
                    '11-25': 'Thanksgiving',
                    '11-26': 'Black Friday',
                    '12-24': 'Christmas Eve',
                    '12-25': 'Christmas Day',
                    '12-31': "New Year's Eve",
                  };
                  
                  if (holidays[md]) {
                    return `Holiday (${holidays[md]})`;
                  }
                  
                  // Check day before/after holiday
                  const tomorrow = new Date(timestamp + 24 * 60 * 60 * 1000);
                  const tMonth = tomorrow.getMonth() + 1;
                  const tDate = tomorrow.getDate();
                  const tMd = `${tMonth.toString().padStart(2, '0')}-${tDate.toString().padStart(2, '0')}`;
                  if (holidays[tMd]) {
                    return `Holiday Eve (${holidays[tMd]})`;
                  }
                  
                  return null;
                };

                if (!formData) return null;

                const userCards = (localTimeCards || []).filter(c => c.userId === formData.id);
                const userRequests = formData.timeOffRequests || [];
                
                const now = Date.now();
                let rangeDays = 30;
                if (reviewRange === '60') rangeDays = 60;
                else if (reviewRange === '90') rangeDays = 90;
                else if (reviewRange === 'yearly') rangeDays = 365;
                else if (reviewRange === 'complete') rangeDays = 9999;
                
                const rangeStart = rangeDays === 9999 ? 0 : now - rangeDays * 24 * 60 * 60 * 1000;
                const priorStart = rangeDays === 9999 ? 0 : rangeStart - rangeDays * 24 * 60 * 60 * 1000;
                const priorEnd = rangeStart;
                
                // Active range filters
                const shiftsWorked = userCards.filter(c => c.status === 'Complete' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                const sickCards = userCards.filter(c => c.status === 'Sick' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                const noCallCards = userCards.filter(c => c.status === 'No-Call No-Show' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                const tardyCards = userCards.filter(c => c.status === 'Complete' && c.minutesLate && c.minutesLate > 0 && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                const timeOffRequests = userRequests.filter(req => {
                  const t = req.submittedAt || new Date(req.startDate).getTime();
                  return rangeDays === 9999 ? true : (t >= rangeStart && t < now);
                });

                // Prior range filters (for trend indicator)
                const priorShifts = userCards.filter(c => c.status === 'Complete' && c.clockIn >= priorStart && c.clockIn < priorEnd).length;
                const priorSick = userCards.filter(c => c.status === 'Sick' && c.clockIn >= priorStart && c.clockIn < priorEnd).length;
                const priorNoCall = userCards.filter(c => c.status === 'No-Call No-Show' && c.clockIn >= priorStart && c.clockIn < priorEnd).length;
                const priorTardys = userCards.filter(c => c.status === 'Complete' && c.minutesLate && c.minutesLate > 0 && c.clockIn >= priorStart && c.clockIn < priorEnd).length;
                const priorTimeOff = userRequests.filter(req => {
                  const t = req.submittedAt || new Date(req.startDate).getTime();
                  return t >= priorStart && t < priorEnd;
                }).length;

                // Team calculations
                const teamStats = (() => {
                  const teamUserIds = users.length > 0 ? users.map(u => u.id) : Array.from(new Set(localTimeCards.map(c => c.userId)));
                  let totalShifts = 0;
                  let totalSick = 0;
                  let totalNoCall = 0;
                  let totalTardys = 0;
                  let totalTimeOff = 0;

                  teamUserIds.forEach(uid => {
                    const uCards = localTimeCards.filter(c => c.userId === uid);
                    const uShifts = uCards.filter(c => c.status === 'Complete' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                    const uSick = uCards.filter(c => c.status === 'Sick' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                    const uNoCall = uCards.filter(c => c.status === 'No-Call No-Show' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                    const uTardys = uCards.filter(c => c.status === 'Complete' && c.minutesLate && c.minutesLate > 0 && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;

                    const uObj = users.find(u => u.id === uid) || (uid === formData.id ? formData : null);
                    const uRequests = uObj?.timeOffRequests || [];
                    const uTimeOff = uRequests.filter(req => {
                      const t = req.submittedAt || new Date(req.startDate).getTime();
                      return rangeDays === 9999 ? true : (t >= rangeStart && t < now);
                    }).length;

                    totalShifts += uShifts;
                    totalSick += uSick;
                    totalNoCall += uNoCall;
                    totalTardys += uTardys;
                    totalTimeOff += uTimeOff;
                  });

                  return {
                    sickRate: totalShifts + totalSick > 0 ? totalSick / (totalShifts + totalSick) : 0,
                    tardyRate: totalShifts > 0 ? totalTardys / totalShifts : 0,
                    noCallRate: totalShifts + totalNoCall > 0 ? totalNoCall / (totalShifts + totalNoCall) : 0,
                    timeOffRate: totalShifts + totalTimeOff > 0 ? totalTimeOff / (totalShifts + totalTimeOff) : 0,
                  };
                })();

                // User rates
                const userSickRate = shiftsWorked + sickCards.length > 0 ? sickCards.length / (shiftsWorked + sickCards.length) : 0;
                const userTardyRate = shiftsWorked > 0 ? tardyCards.length / shiftsWorked : 0;
                const userNoCallRate = shiftsWorked + noCallCards.length > 0 ? noCallCards.length / (shiftsWorked + noCallCards.length) : 0;
                const userTimeOffRate = shiftsWorked + timeOffRequests.length > 0 ? timeOffRequests.length / (shiftsWorked + timeOffRequests.length) : 0;

                // Reliability calculations
                const reliabilityCalculations = (() => {
                  // Calculate team totals in selected period
                  const teamUserIds = users.length > 0 ? users.map(u => u.id) : Array.from(new Set(localTimeCards.map(c => c.userId)));
                  let teamTotalShifts = 0;
                  let teamTotalNoCallPoints = 0;
                  let teamTotalSickPoints = 0;
                  let teamTotalTardyPoints = 0;
                  let teamTotalTimeOffPoints = 0;

                  teamUserIds.forEach(uid => {
                    const uCards = localTimeCards.filter(c => c.userId === uid);
                    const uShifts = uCards.filter(c => c.status === 'Complete' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                    
                    // No-shows points
                    const uNoShowsCount = uCards.filter(c => c.status === 'No-Call No-Show' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                    const uNoShowPoints = uNoShowsCount * RELIABILITY_CONFIG.weights.noCallShow;

                    // Sick points
                    let uSickPoints = 0;
                    const uSickCards = uCards.filter(c => c.status === 'Sick' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                    uSickCards.forEach(c => {
                      if (c.sickDocumentationProvided) {
                        uSickPoints += RELIABILITY_CONFIG.weights.sickWithDoc;
                      } else {
                        uSickPoints += RELIABILITY_CONFIG.weights.sickNoDoc;
                        if (isNearWeekendOrHoliday(c.clockIn)) {
                          uSickPoints += RELIABILITY_CONFIG.weights.weekendHolidaySickPenalty;
                        }
                      }
                    });

                    // Tardy points
                    let uTardyPoints = 0;
                    const uTardyCards = uCards.filter(c => c.status === 'Complete' && c.minutesLate && c.minutesLate > 0 && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                    uTardyCards.forEach(c => {
                      const mins = c.minutesLate || 0;
                      uTardyPoints += Math.min(10, Math.ceil(mins / 5)) * RELIABILITY_CONFIG.weights.tardyPer5Min;
                    });

                    // Time off points (unplanned)
                    const uObj = users.find(u => u.id === uid) || (uid === formData.id ? formData : null);
                    const uRequests = uObj?.timeOffRequests || [];
                    const uTimeOffRequests = uRequests.filter(req => {
                      const t = req.submittedAt || new Date(req.startDate).getTime();
                      return rangeDays === 9999 ? true : (t >= rangeStart && t < now);
                    });
                    let uTimeOffPoints = 0;
                    uTimeOffRequests.forEach(req => {
                      if (req.requestedInAdvance === false) {
                        uTimeOffPoints += RELIABILITY_CONFIG.weights.unplannedTimeOff;
                      }
                    });

                    teamTotalShifts += uShifts;
                    teamTotalNoCallPoints += uNoShowPoints;
                    teamTotalSickPoints += uSickPoints;
                    teamTotalTardyPoints += uTardyPoints;
                    teamTotalTimeOffPoints += uTimeOffPoints;
                  });

                  // User raw points
                  const userNoShowRaw = noCallCards.length * RELIABILITY_CONFIG.weights.noCallShow;
                  
                  let userSickRaw = 0;
                  sickCards.forEach(c => {
                    if (c.sickDocumentationProvided) {
                      userSickRaw += RELIABILITY_CONFIG.weights.sickWithDoc;
                    } else {
                      userSickRaw += RELIABILITY_CONFIG.weights.sickNoDoc;
                      if (isNearWeekendOrHoliday(c.clockIn)) {
                        userSickRaw += RELIABILITY_CONFIG.weights.weekendHolidaySickPenalty;
                      }
                    }
                  });

                  let userTardyRaw = 0;
                  tardyCards.forEach(c => {
                    const mins = c.minutesLate || 0;
                    userTardyRaw += Math.min(10, Math.ceil(mins / 5)) * RELIABILITY_CONFIG.weights.tardyPer5Min;
                  });

                  let userTimeOffRaw = 0;
                  timeOffRequests.forEach(req => {
                    if (req.requestedInAdvance === false) {
                      userTimeOffRaw += RELIABILITY_CONFIG.weights.unplannedTimeOff;
                    }
                  });

                  // Safe divisions to avoid NaN
                  const S_user = Math.max(1, shiftsWorked);
                  const S_team = Math.max(1, teamTotalShifts);

                  const R_user_noshow = userNoShowRaw / S_user;
                  const R_team_noshow = teamTotalNoCallPoints / S_team;

                  const R_user_sick = userSickRaw / S_user;
                  const R_team_sick = teamTotalSickPoints / S_team;

                  const R_user_tardy = userTardyRaw / S_user;
                  const R_team_tardy = teamTotalTardyPoints / S_team;

                  const R_user_timeoff = userTimeOffRaw / S_user;
                  const R_team_timeoff = teamTotalTimeOffPoints / S_team;

                  // Baseline Damped Comparison Factors
                  const getComparisonFactor = (userRate: number, teamRate: number) => {
                    return Math.min(2.0, Math.max(0.5, (userRate + 0.5) / (teamRate + 0.5)));
                  };

                  const C_noshow = getComparisonFactor(R_user_noshow, R_team_noshow);
                  const C_sick = getComparisonFactor(R_user_sick, R_team_sick);
                  const C_tardy = getComparisonFactor(R_user_tardy, R_team_tardy);
                  const C_timeoff = getComparisonFactor(R_user_timeoff, R_team_timeoff);

                  // Normalized Deductions (using a 10-shift reference baseline)
                  const noCallDeduction = userNoShowRaw * (10 / S_user) * C_noshow;
                  const sickDeduction = userSickRaw * (10 / S_user) * C_sick;
                  const tardyDeduction = userTardyRaw * (10 / S_user) * C_tardy;
                  const timeOffDeduction = userTimeOffRaw * (10 / S_user) * C_timeoff;

                  // Rounded for layout display
                  const displayNoCall = Math.round(noCallDeduction * 10) / 10;
                  const displaySick = Math.round(sickDeduction * 10) / 10;
                  const displayTardy = Math.round(tardyDeduction * 10) / 10;
                  const displayTimeOff = Math.round(timeOffDeduction * 10) / 10;

                  const totalDeductions = displayNoCall + displaySick + displayTardy + displayTimeOff;
                  const finalScore = Math.max(0, Math.min(100, Math.round(100 - totalDeductions)));

                  let rating: 'Excellent' | 'Good' | 'Needs Attention' | 'At Risk' = 'Excellent';
                  let ratingColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
                  if (finalScore >= 90) {
                    rating = 'Excellent';
                    ratingColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
                  } else if (finalScore >= 75) {
                    rating = 'Good';
                    ratingColor = 'text-teal-700 bg-teal-50 border-teal-200';
                  } else if (finalScore >= 55) {
                    rating = 'Needs Attention';
                    ratingColor = 'text-amber-700 bg-amber-50 border-amber-200';
                  } else {
                    rating = 'At Risk';
                    ratingColor = 'text-rose-700 bg-rose-50 border-rose-200';
                  }

                  return {
                    score: finalScore,
                    rating,
                    ratingColor,
                    deductions: {
                      noCall: displayNoCall,
                      sick: displaySick,
                      tardy: displayTardy,
                      timeOff: displayTimeOff
                    }
                  };
                })();

                // Warnings Banner
                const warningBanners = (() => {
                  const banners: string[] = [];
                  const suffix = rangeDays === 9999 ? 'all-time' : `last ${rangeDays} days`;
                  
                  if (noCallCards.length >= RELIABILITY_CONFIG.thresholds.noCallShows) {
                    banners.push(`⚠ ${noCallCards.length} no-shows in ${suffix} — review before assigning to upcoming events.`);
                  }
                  if (tardyCards.length >= RELIABILITY_CONFIG.thresholds.tardys) {
                    banners.push(`⚠ ${tardyCards.length} tardys in ${suffix} — check shift alignment/punctuality.`);
                  }
                  const undocumentedSick = sickCards.filter(c => !c.sickDocumentationProvided).length;
                  if (undocumentedSick >= RELIABILITY_CONFIG.thresholds.undocumentedSick) {
                    banners.push(`⚠ ${undocumentedSick} undocumented sick call-ins in ${suffix} — verify documentation policy compliance.`);
                  }
                  return banners;
                })();

                // Helper to calculate trend
                const getTrendIndicator = (current: number, prior: number) => {
                  if (rangeDays === 9999) return null; // No trend for complete/all-time
                  if (prior === 0) {
                    return current === 0 ? null : { text: `+${current}`, isWorse: true };
                  }
                  const pct = Math.round(((current - prior) / prior) * 100);
                  if (pct === 0) return null;
                  return {
                    text: pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`,
                    isWorse: pct > 0 // positive change for absence/lateness is worse
                  };
                };

                // Helper to format rate baseline comparison
                const getBaselineDiffText = (userVal: number, teamVal: number) => {
                  const diff = (userVal - teamVal) * 100;
                  if (Math.abs(diff) < 0.1) return 'Matches team average';
                  const formatted = Math.abs(diff).toFixed(1) + '%';
                  if (diff > 0) {
                    return `${formatted} above team average`;
                  } else {
                    return `${formatted} below team average`;
                  }
                };

                return (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setShowReviewDropdown(!showReviewDropdown)}
                      className="w-full flex items-center gap-2 border-b border-zinc-100 pb-2 text-left hover:opacity-85 transition-all"
                    >
                      {showReviewDropdown ? (
                        <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                      )}
                      <ClipboardCheck className="w-4 h-4 text-zinc-500 shrink-0" />
                      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0">Review</span>
                    </button>

                    {showReviewDropdown && (
                      <div className="mt-4 space-y-5 bg-zinc-50/30 border border-zinc-200 rounded-lg p-4 animate-in slide-in-from-top-2 duration-200">
                        {/* Header controls: Range Tabs */}
                        <div className="flex border border-zinc-200 rounded-lg overflow-hidden w-fit bg-white shadow-sm">
                          {(['30', '60', '90', 'yearly', 'complete'] as const).map(range => (
                            <button
                              key={range}
                              type="button"
                              onClick={() => {
                                setReviewRange(range);
                                setActiveDrilldown(null);
                              }}
                              className={`px-3 py-1.5 text-[10px] sm:text-xs font-bold transition-colors ${
                                reviewRange === range
                                  ? 'bg-zinc-900 text-white'
                                  : 'text-zinc-600 hover:bg-zinc-50'
                              }`}
                            >
                              {range === '30' && '30 Days'}
                              {range === '60' && '60 Days'}
                              {range === '90' && '90 Days'}
                              {range === 'yearly' && 'Yearly'}
                              {range === 'complete' && 'Complete'}
                            </button>
                          ))}
                        </div>

                        {/* Reliability Score Banner */}
                        <div className="bg-zinc-900 text-white border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Composite Reliability Score</span>
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="text-3xl font-extrabold">{reliabilityCalculations.score}/100</span>
                              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${reliabilityCalculations.ratingColor.replace('bg-', 'bg-white/10 ').replace('text-', 'text-')}`}>
                                {reliabilityCalculations.rating}
                              </span>
                              {shiftsWorked < RELIABILITY_CONFIG.thresholds.lowSampleSizeShifts && (
                                <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35 px-2.5 py-0.5 rounded-full shrink-0 animate-pulse">
                                  ⚠ Limited data — only {shiftsWorked} shifts this period
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-400 max-w-lg pt-1">
                              Calculated weighted score based on punctuality, undocumented sick absences, and unplanned time off. Authorized vacation time does not count against this score.
                            </p>
                          </div>
                          
                          {/* Mini breakdown of deductions & shift count */}
                          <div className="flex gap-4 shrink-0 text-center text-xs border-t sm:border-t-0 sm:border-l border-zinc-800 pt-3 sm:pt-0 sm:pl-6">
                            <div>
                              <div className="text-[10px] text-zinc-500 font-bold uppercase cursor-help" title="To show scheduled vs worked shifts (e.g. X of Y), schedule data needs to be passed via props.">Shifts ⓘ</div>
                              <div className="font-semibold text-zinc-300">
                                {shiftsWorked}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-zinc-500 font-bold uppercase">No-Show</div>
                              <div className={`font-semibold ${reliabilityCalculations.deductions.noCall > 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                                -{reliabilityCalculations.deductions.noCall}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-zinc-500 font-bold uppercase">Sick</div>
                              <div className={`font-semibold ${reliabilityCalculations.deductions.sick > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                                -{reliabilityCalculations.deductions.sick}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-zinc-500 font-bold uppercase">Tardy</div>
                              <div className={`font-semibold ${reliabilityCalculations.deductions.tardy > 0 ? 'text-indigo-400' : 'text-zinc-500'}`}>
                                -{reliabilityCalculations.deductions.tardy}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-zinc-500 font-bold uppercase">Time Off</div>
                              <div className={`font-semibold ${reliabilityCalculations.deductions.timeOff > 0 ? 'text-blue-400' : 'text-zinc-500'}`}>
                                -{reliabilityCalculations.deductions.timeOff}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Warnings Banner Stack */}
                        {warningBanners.length > 0 && (
                          <div className="space-y-2">
                            {warningBanners.map((banner, index) => (
                              <div key={index} className="bg-rose-50/80 border border-rose-200/60 rounded-xl p-3 text-xs text-rose-800 flex items-start gap-2.5 animate-in slide-in-from-top-1">
                                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                <span className="font-semibold leading-normal">{banner}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Metric Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {/* Sick Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'sick' ? null : 'sick')}
                            className={`bg-white border rounded-xl p-4 flex flex-col justify-between min-h-[110px] hover:scale-[1.02] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'sick' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Sick Call-ins</span>
                              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                            </div>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-2xl font-black text-zinc-900">{sickCards.length}</span>
                              {/* Trend Badge */}
                              {(() => {
                                const trend = getTrendIndicator(sickCards.length, priorSick);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-2 text-[10px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{sickCards.length} sick / {shiftsWorked} shifts</div>
                              <div className={`font-medium ${userSickRate > teamStats.sickRate ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userSickRate, teamStats.sickRate)}
                              </div>
                            </div>
                          </div>

                          {/* Time Off Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'timeOff' ? null : 'timeOff')}
                            className={`bg-white border rounded-xl p-4 flex flex-col justify-between min-h-[110px] hover:scale-[1.02] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'timeOff' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Time Off</span>
                              <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                            </div>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-2xl font-black text-zinc-900">{timeOffRequests.length}</span>
                              {(() => {
                                const trend = getTrendIndicator(timeOffRequests.length, priorTimeOff);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-2 text-[10px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{timeOffRequests.length} off / {shiftsWorked} shifts</div>
                              <div className={`font-medium ${userTimeOffRate > teamStats.timeOffRate ? 'text-zinc-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userTimeOffRate, teamStats.timeOffRate)}
                              </div>
                            </div>
                          </div>

                          {/* No Call Shows Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'noCall' ? null : 'noCall')}
                            className={`bg-white border rounded-xl p-4 flex flex-col justify-between min-h-[110px] hover:scale-[1.02] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'noCall' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">No Call Shows</span>
                              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                            </div>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-2xl font-black text-zinc-900">{noCallCards.length}</span>
                              {(() => {
                                const trend = getTrendIndicator(noCallCards.length, priorNoCall);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-2 text-[10px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{noCallCards.length} missed / {shiftsWorked} shifts</div>
                              <div className={`font-medium ${userNoCallRate > teamStats.noCallRate ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userNoCallRate, teamStats.noCallRate)}
                              </div>
                            </div>
                          </div>

                          {/* Tardys Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'tardy' ? null : 'tardy')}
                            className={`bg-white border rounded-xl p-4 flex flex-col justify-between min-h-[110px] hover:scale-[1.02] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'tardy' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Tardys</span>
                              <Clock className="w-4 h-4 text-indigo-500 shrink-0" />
                            </div>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-2xl font-black text-zinc-900">{tardyCards.length}</span>
                              {(() => {
                                const trend = getTrendIndicator(tardyCards.length, priorTardys);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-2 text-[10px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{tardyCards.length} late / {shiftsWorked} shifts</div>
                              <div className={`font-medium ${userTardyRate > teamStats.tardyRate ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userTardyRate, teamStats.tardyRate)}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Active Drilldown Section */}
                        {activeDrilldown && (
                          <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-inner mt-2 space-y-4 animate-in slide-in-from-bottom-2 duration-200">
                            {/* Sick Call-ins details */}
                            {activeDrilldown === 'sick' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Sick Call-ins Logs ({sickCards.length} instances)</h5>
                                  <span className="text-[10px] text-zinc-400 font-semibold italic">Toggle status or review weekend patterns</span>
                                </div>
                                {sickCards.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No sick call-ins logged for this period.</p>
                                ) : (
                                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                    {sickCards.map(card => {
                                      const proxy = isNearWeekendOrHoliday(card.clockIn);
                                      return (
                                        <div key={card.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-zinc-50 border border-zinc-150 rounded-lg hover:bg-zinc-100/55 transition-colors">
                                          <div>
                                            <div className="text-xs font-bold text-zinc-800">{new Date(card.clockIn).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                            {card.managerNotes && <div className="text-[10px] text-zinc-500 italic mt-0.5">Note: "{card.managerNotes}"</div>}
                                          </div>
                                          
                                          <div className="flex flex-wrap items-center gap-2">
                                            {proxy && (
                                              <span className="text-[9px] font-bold bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                                                ⚠️ {proxy}
                                              </span>
                                            )}
                                            
                                            {/* Documentation toggle button */}
                                            <button
                                              type="button"
                                              onClick={() => handleToggleSickDoc(card.id)}
                                              className={`text-[9px] font-bold px-2 py-1 rounded border transition-all ${
                                                card.sickDocumentationProvided
                                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100/70'
                                                  : 'bg-zinc-100 border-zinc-300 text-zinc-700 hover:bg-zinc-200/80'
                                              }`}
                                            >
                                              {card.sickDocumentationProvided ? '✓ Document Provided' : '+ Add Documentation'}
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Time Off details */}
                            {activeDrilldown === 'timeOff' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Time Off Requests Log ({timeOffRequests.length} instances)</h5>
                                </div>
                                {timeOffRequests.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No time off requests recorded for this period.</p>
                                ) : (
                                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                    {timeOffRequests.map(req => {
                                      const isPlanned = req.requestedInAdvance !== false;
                                      return (
                                        <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-zinc-50 border border-zinc-150 rounded-lg">
                                          <div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-bold text-zinc-850">
                                                {new Date(req.startDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                {req.startDate !== req.endDate && ` - ${new Date(req.endDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
                                              </span>
                                              <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 tracking-wider">
                                                {req.category || 'Vacation'}
                                              </span>
                                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                                req.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : req.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                                              }`}>
                                                {req.status}
                                              </span>
                                            </div>
                                            <div className="text-[10px] text-zinc-500 mt-1">Reason: "{req.reason || 'None specified'}"</div>
                                          </div>
                                          
                                          <div className="shrink-0">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                              isPlanned
                                                ? 'bg-blue-50 border-blue-100 text-blue-700'
                                                : 'bg-rose-50 border-rose-100 text-rose-700'
                                            }`}>
                                              {isPlanned ? 'Notice Provided' : 'Last-Minute Request'}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* No Call Shows details */}
                            {activeDrilldown === 'noCall' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">No Call Shows Log ({noCallCards.length} instances)</h5>
                                  <span className="text-[10px] text-zinc-400 font-semibold italic">Log coverage tracking</span>
                                </div>
                                {noCallCards.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No-shows logged for this period.</p>
                                ) : (
                                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                    {noCallCards.map(card => (
                                      <div key={card.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-zinc-50 border border-zinc-150 rounded-lg hover:bg-zinc-100/55 transition-colors">
                                        <div>
                                          <div className="text-xs font-bold text-zinc-800">{new Date(card.clockIn).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                          <div className="text-[10px] text-red-500 font-bold mt-0.5">Missed Shift: {card.missedShiftTitle || 'Not specified'}</div>
                                        </div>
                                        
                                        <div className="flex items-center gap-2 shrink-0">
                                          <span className="text-[10px] text-zinc-500 font-semibold">Coverage:</span>
                                          
                                          {/* Dropdown select to log coverage */}
                                          <select
                                            value={card.coveredByUserId || ''}
                                            onChange={(e) => handleUpdateNoCallCover(card.id, e.target.value)}
                                            className="text-[10px] font-medium border-zinc-300 rounded bg-white py-0.5 px-2 focus:ring-zinc-500 focus:border-zinc-300"
                                          >
                                            <option value="">No cover logged</option>
                                            {users.filter(u => u.id !== formData.id).map(u => (
                                              <option key={u.id} value={u.id}>Covered by {u.name}</option>
                                            ))}
                                          </select>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Tardys details */}
                            {activeDrilldown === 'tardy' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Tardys Log ({tardyCards.length} instances)</h5>
                                  <span className="text-[10px] text-zinc-400 font-semibold italic">Granular latency tracker</span>
                                </div>
                                {tardyCards.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No tardy clock-ins logged for this period.</p>
                                ) : (
                                  <div className="space-y-3">
                                    {/* Display clustering statistics summary */}
                                    {(() => {
                                      const dayCounts: Record<string, number> = {};
                                      const shiftCounts: Record<string, number> = {};
                                      
                                      tardyCards.forEach(c => {
                                        const dateVal = new Date(c.clockIn);
                                        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateVal.getDay()];
                                        dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
                                        
                                        const shift = c.tardyShiftTitle || 'Default Shift';
                                        shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
                                      });
                                      
                                      const peakDays = Object.entries(dayCounts).filter(([_, count]) => count >= 2).map(([day]) => day);
                                      const peakShifts = Object.entries(shiftCounts).filter(([name, count]) => name !== 'Default Shift' && count >= 2).map(([name]) => name);
                                      
                                      if (peakDays.length === 0 && peakShifts.length === 0) return null;
                                      return (
                                        <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-lg text-[11px] text-indigo-950 space-y-1">
                                          <div className="font-bold flex items-center gap-1">
                                            <AlertCircle className="w-3.5 h-3.5 text-indigo-600" />
                                            Punctuality Cluster Alert
                                          </div>
                                          {peakDays.length > 0 && <div>• Repeated tardiness clustered on: <span className="font-bold">{peakDays.join(', ')}s</span>.</div>}
                                          {peakShifts.length > 0 && <div>• Repeated tardiness clustered during: <span className="font-bold">{peakShifts.join(', ')}</span>.</div>}
                                        </div>
                                      );
                                    })()}
                                    
                                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                                      {tardyCards.map(card => {
                                        const isHighTardy = (card.minutesLate || 0) > 30;
                                        const isMidTardy = (card.minutesLate || 0) > 10 && (card.minutesLate || 0) <= 30;
                                        
                                        return (
                                          <div key={card.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-zinc-50 border border-zinc-150 rounded-lg">
                                            <div>
                                              <div className="text-xs font-bold text-zinc-800">
                                                {new Date(card.clockIn).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                              </div>
                                              <div className="text-[10px] text-zinc-500 mt-0.5">Shift: {card.tardyShiftTitle || 'Not specified'}</div>
                                            </div>
                                            
                                            <div className="shrink-0 flex items-center gap-2">
                                              <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                                                isHighTardy
                                                  ? 'bg-rose-50 border-rose-200 text-rose-700 font-extrabold'
                                                  : isMidTardy
                                                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                                                  : 'bg-zinc-100 border-zinc-200 text-zinc-650'
                                              }`}>
                                                {card.minutesLate} mins late
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Permissions Section */}
              <section className="space-y-2" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowPermsDropdown(!showPermsDropdown)}
                  className="w-full flex items-center gap-2 border-b border-zinc-100 pb-2 text-left hover:opacity-85 transition-all"
                >
                  {showPermsDropdown ? (
                    <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                  )}
                  <Lock className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0">Permissions</span>
                </button>

                {showPermsDropdown && (
                  <div className="mt-2 bg-white border border-zinc-200 rounded-lg p-4 space-y-4">
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