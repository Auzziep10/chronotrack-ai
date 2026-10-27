import React, { useState, useEffect, useRef } from 'react';
import { X, User as UserIcon, Phone, Mail, MapPin, Briefcase, Clock, AlertTriangle, AlertCircle, Save, MessageSquare, Lock, Check, FileText, Download, ChevronDown, ChevronUp, ChevronRight, Shield, Target, Key, DollarSign, ClipboardCheck, Calendar, ArrowUp, ArrowDown, FileWarning, PenTool, CheckCircle2, Plus } from 'lucide-react';
import { User, DayOfWeek, DailyAvailability, Department, DisciplinaryWriteUp, WriteUpCategory, TimeOffRequest, AttendanceAuditEntry } from '../types';
import { AVAILABLE_PERMISSIONS } from '../constants';
import { DigitalWriteUpModal } from './DigitalWriteUpModal';

interface Props {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedUser: User) => void;
  onQuickUpdate?: (updatedUser: User) => void;
  onTimeCardSaved?: (card: any) => void;
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

export const UserProfileDialog: React.FC<Props> = ({ user, isOpen, onClose, onSave, onQuickUpdate, onTimeCardSaved, isViewerAdmin = false, viewerUser = null, timeCards = [], users = [] }) => {
  const [formData, setFormData] = useState<User | null>(null);
  const [showPermsDropdown, setShowPermsDropdown] = useState(false);
  const [showSchedulingDropdown, setShowSchedulingDropdown] = useState(false);
  const [showDocumentsDropdown, setShowDocumentsDropdown] = useState(false);
  const [showWriteUpsDropdown, setShowWriteUpsDropdown] = useState(true);
  const [showWriteUpModal, setShowWriteUpModal] = useState(false);
  const [selectedWriteUp, setSelectedWriteUp] = useState<DisciplinaryWriteUp | null>(null);
  const [initialWriteUpCategory, setInitialWriteUpCategory] = useState<WriteUpCategory>('Failure to Communicate');
  const [initialWriteUpIncidentDate, setInitialWriteUpIncidentDate] = useState<string | undefined>(undefined);
  const [initialWriteUpShiftTitle, setInitialWriteUpShiftTitle] = useState<string>('');
  const [initialWriteUpDescription, setInitialWriteUpDescription] = useState<string | undefined>(undefined);
  const [reviewRange, setReviewRange] = useState<'30' | '60' | '90' | 'yearly' | 'complete'>('30');
  const [localTimeCards, setLocalTimeCards] = useState<any[]>(timeCards || []);
  const [activeDrilldown, setActiveDrilldown] = useState<'sick' | 'timeOff' | 'noCall' | 'tardy' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const todayIsoStr = () => {
    const now = Date.now();
    const tzOffset = now - new Date(now).getTimezoneOffset() * 60000;
    return new Date(tzOffset).toISOString().split('T')[0];
  };

  // Input states for the 4 clickable Review cards
  const [sickInputType, setSickInputType] = useState<'Sick' | 'Emergency'>('Sick');
  const [sickInputDate, setSickInputDate] = useState<string>(todayIsoStr);
  const [sickInputDocProvided, setSickInputDocProvided] = useState<boolean>(false);
  const [sickInputNotes, setSickInputNotes] = useState<string>('');

  const [timeOffStartDate, setTimeOffStartDate] = useState<string>(todayIsoStr);
  const [timeOffEndDate, setTimeOffEndDate] = useState<string>(todayIsoStr);
  const [timeOffCategory, setTimeOffCategory] = useState<NonNullable<TimeOffRequest['category']>>('Vacation');
  const [timeOffStatus, setTimeOffStatus] = useState<TimeOffRequest['status']>('Approved');
  const [timeOffInAdvance, setTimeOffInAdvance] = useState<boolean>(true);
  const [timeOffReason, setTimeOffReason] = useState<string>('');

  const [noCallInputDate, setNoCallInputDate] = useState<string>(todayIsoStr);
  const [noCallInputShiftTitle, setNoCallInputShiftTitle] = useState<string>('');
  const [noCallInputCoveredBy, setNoCallInputCoveredBy] = useState<string>('');
  const [noCallInputNotes, setNoCallInputNotes] = useState<string>('');

  const [tardyInputDate, setTardyInputDate] = useState<string>(todayIsoStr);
  const [tardyInputMinutes, setTardyInputMinutes] = useState<string>('15');
  const [tardyInputShiftTitle, setTardyInputShiftTitle] = useState<string>('');
  const [tardyInputProtocolType, setTardyInputProtocolType] = useState<'Late_Clock_In' | '5_Min_Tardy_Alert' | '30_Min_No_Response'>('Late_Clock_In');
  const [tardyInputNotes, setTardyInputNotes] = useState<string>('');

  const persistUserUpdate = (updatedUser: User) => {
    setFormData(updatedUser);
    if (onQuickUpdate) {
      onQuickUpdate(updatedUser);
    } else {
      import('../services/firebaseService').then(({ firebaseSaveUser, isFirebaseConfigured }) => {
        if (isFirebaseConfigured()) {
          firebaseSaveUser(updatedUser).catch(console.error);
        }
      });
    }
  };

  const persistTimeCard = (card: any) => {
    setLocalTimeCards(prev => {
      const exists = prev.some(c => c.id === card.id);
      return exists ? prev.map(c => (c.id === card.id ? card : c)) : [card, ...prev];
    });
    if (onTimeCardSaved) {
      onTimeCardSaved(card);
    }
    import('../services/storageService').then(mod => {
      mod.storageService.saveTimeCard(card);
    });
    import('../services/firebaseService').then(({ firebaseSaveTimeCard, isFirebaseConfigured }) => {
      if (isFirebaseConfigured() && !String(card.id).startsWith('active-')) {
        firebaseSaveTimeCard(card).catch(console.error);
      }
    });
  };

  const handleLogSickOrEmergency = () => {
    if (!formData || !sickInputDate) return;
    const ts = new Date(`${sickInputDate}T09:00:00`).getTime() || Date.now();
    const newCard = {
      id: `tc-abs-${formData.id}-${Date.now()}`,
      userId: formData.id,
      date: sickInputDate,
      clockIn: ts,
      clockOut: ts,
      totalHours: 0,
      totalIdleHours: 0,
      status: sickInputType,
      sickDocumentationProvided: sickInputDocProvided,
      managerNotes: sickInputNotes.trim() || (sickInputType === 'Emergency' ? 'Family emergency call-in' : 'Sick call-in'),
    };
    persistTimeCard(newCard);
    setSickInputNotes('');
    setSickInputDocProvided(false);
  };

  const handleLogTimeOffRequest = () => {
    if (!formData || !timeOffStartDate) return;
    const end = timeOffEndDate && timeOffEndDate >= timeOffStartDate ? timeOffEndDate : timeOffStartDate;
    const newReq: TimeOffRequest = {
      id: `tor-${formData.id}-${Date.now()}`,
      startDate: timeOffStartDate,
      endDate: end,
      status: timeOffStatus,
      category: timeOffCategory,
      requestedInAdvance: timeOffInAdvance,
      reason: timeOffReason.trim() || `${timeOffCategory} request`,
      submittedAt: Date.now(),
    };
    const updatedUser: User = {
      ...formData,
      timeOffRequests: [newReq, ...(formData.timeOffRequests || [])],
    };
    persistUserUpdate(updatedUser);
    setTimeOffReason('');
  };

  const handleUpdateTimeOffStatus = (reqId: string, nextStatus: TimeOffRequest['status']) => {
    if (!formData) return;
    const updatedRequests = (formData.timeOffRequests || []).map(r =>
      r.id === reqId ? { ...r, status: nextStatus } : r
    );
    persistUserUpdate({ ...formData, timeOffRequests: updatedRequests });
  };

  const handleLogNoCallNoShow = () => {
    if (!formData || !noCallInputDate) return;
    const now = Date.now();
    const ts = new Date(`${noCallInputDate}T09:00:00`).getTime() || now;
    const coverUser = users.find(u => u.id === noCallInputCoveredBy);
    const shiftLabel = noCallInputShiftTitle.trim() || 'Scheduled Shift';

    const newCard = {
      id: `tc-ncns-${formData.id}-${now}`,
      userId: formData.id,
      date: noCallInputDate,
      clockIn: ts,
      clockOut: ts,
      totalHours: 0,
      totalIdleHours: 0,
      status: 'No-Call No-Show' as const,
      missedShiftTitle: shiftLabel,
      coveredByUserId: coverUser ? coverUser.id : undefined,
      coveredByUserName: coverUser ? coverUser.name : undefined,
      managerNotes: noCallInputNotes.trim() || 'No-Call No-Show logged by management',
    };
    persistTimeCard(newCard);

    // Link to Clock-In Tardy Protocol tools (Audit Log + Pending Signature Write-Up)
    const auditEntry: AttendanceAuditEntry = {
      id: `audit-ncns-${now}`,
      date: noCallInputDate,
      timestamp: ts,
      type: 'No_Call_No_Show',
      shiftTitle: shiftLabel,
      details: `Logged as No-Call No-Show for ${shiftLabel} by ${viewerUser?.name || 'Manager'}.${noCallInputNotes.trim() ? ` Notes: ${noCallInputNotes.trim()}` : ''}`,
    };

    const existingWriteUps = formData.disciplinaryWriteUps || [];
    const hasWriteUpForDate = existingWriteUps.some(w => w.incidentDate === noCallInputDate && w.category === 'No-Call No-Show');
    const ncnsWriteUp: DisciplinaryWriteUp | null = hasWriteUpForDate
      ? null
      : {
          id: `wu-ncns-${now}`,
          userId: formData.id,
          userName: formData.name,
          date: todayIsoStr(),
          createdAt: now,
          issuedByManagerId: viewerUser?.id || 'system-attendance',
          issuedByManagerName: viewerUser?.name || 'Clockwork Manager',
          category: 'No-Call No-Show',
          severity: 'Final Written Warning (Strike 2)',
          incidentDate: noCallInputDate,
          shiftTitle: shiftLabel,
          description: `${formData.name} failed to report for ${shiftLabel} on ${noCallInputDate} without prior notice or communication.${noCallInputNotes.trim() ? ` Notes: ${noCallInputNotes.trim()}` : ''}`,
          correctiveActionPlan:
            'Team member must adhere to all scheduled shifts and notify management at least 2 hours prior to shift start in the event of an emergency. Any further No-Call No-Show infraction may result in immediate termination.',
          status: 'Pending Signature',
          autoGenerated: true,
        };

    const updatedUser: User = {
      ...formData,
      strikeLevel: Math.max(formData.strikeLevel || 0, 2) as 0 | 1 | 2 | 3,
      attendanceAuditLog: [auditEntry, ...(formData.attendanceAuditLog || [])].slice(0, 100),
      disciplinaryWriteUps: ncnsWriteUp ? [ncnsWriteUp, ...existingWriteUps] : existingWriteUps,
    };
    persistUserUpdate(updatedUser);

    setNoCallInputShiftTitle('');
    setNoCallInputCoveredBy('');
    setNoCallInputNotes('');
  };

  const handleLogTardy = () => {
    if (!formData || !tardyInputDate) return;
    const minsLate = Math.max(1, parseInt(tardyInputMinutes, 10) || 15);
    const now = Date.now();
    const ts = new Date(`${tardyInputDate}T09:00:00`).getTime() || now;
    const shiftLabel = tardyInputShiftTitle.trim() || 'Scheduled Shift';

    // Update existing timecard on that date or create a tardy timecard
    const existingCardOnDate = localTimeCards.find(
      c => c.userId === formData.id && (c.date === tardyInputDate || new Date(c.clockIn).toISOString().split('T')[0] === tardyInputDate) && (c.status === 'Complete' || c.status === 'Active')
    );

    if (existingCardOnDate) {
      const updatedCard = {
        ...existingCardOnDate,
        minutesLate: minsLate,
        tardyShiftTitle: shiftLabel,
        managerNotes: tardyInputNotes.trim() || existingCardOnDate.managerNotes,
      };
      persistTimeCard(updatedCard);
    } else {
      const newCard = {
        id: `tc-tardy-${formData.id}-${now}`,
        userId: formData.id,
        date: tardyInputDate,
        clockIn: ts,
        clockOut: ts + 8 * 60 * 60 * 1000,
        totalHours: 8,
        totalIdleHours: 0,
        status: 'Complete' as const,
        minutesLate: minsLate,
        tardyShiftTitle: shiftLabel,
        managerNotes: tardyInputNotes.trim() || `Logged tardy (${minsLate}m late)`,
      };
      persistTimeCard(newCard);
    }

    // Link to Clock-In Tardy Protocol tools (Audit Log + 30-day rolling count + Strike escalation)
    const auditEntry: AttendanceAuditEntry = {
      id: `audit-tardy-${now}`,
      date: tardyInputDate,
      timestamp: ts,
      type: tardyInputProtocolType,
      shiftTitle: shiftLabel,
      details:
        tardyInputProtocolType === '30_Min_No_Response'
          ? `${formData.name} was ${minsLate}m late for ${shiftLabel} with 30+ mins no response to tardy check-in.${tardyInputNotes.trim() ? ` Notes: ${tardyInputNotes.trim()}` : ''}`
          : `${formData.name} clocked in ${minsLate}m late for ${shiftLabel} (logged by ${viewerUser?.name || 'Manager'}).${tardyInputNotes.trim() ? ` Notes: ${tardyInputNotes.trim()}` : ''}`,
      responseMessage: tardyInputNotes.trim() || undefined,
    };

    const nextAuditLogs = [auditEntry, ...(formData.attendanceAuditLog || [])].slice(0, 100);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const rollingDates = new Set<string>([tardyInputDate]);
    localTimeCards
      .filter(c => c.userId === formData.id && (c.status === 'Complete' || c.status === 'Active') && c.minutesLate && c.minutesLate > 0 && c.clockIn >= thirtyDaysAgo)
      .forEach(c => rollingDates.add(c.date || new Date(c.clockIn).toISOString().split('T')[0]));
    nextAuditLogs
      .filter(l => ['Late_Clock_In', '5_Min_Tardy_Alert', '30_Min_No_Response'].includes(l.type) && l.timestamp >= thirtyDaysAgo)
      .forEach(l => rollingDates.add(l.date));

    const newTardyCount30d = Math.max((formData.tardyCount30Days || 0) + 1, rollingDates.size);
    const strikeFromCount = newTardyCount30d >= 6 ? 3 : newTardyCount30d >= 5 ? 2 : newTardyCount30d >= 3 ? 1 : 0;
    const newStrikeLevel = Math.max(formData.strikeLevel || 0, strikeFromCount, tardyInputProtocolType === '30_Min_No_Response' ? 1 : 0) as 0 | 1 | 2 | 3;

    let nextWriteUps = [...(formData.disciplinaryWriteUps || [])];
    if (tardyInputProtocolType === '30_Min_No_Response' || newTardyCount30d === 3 || newTardyCount30d === 5 || newTardyCount30d >= 6) {
      const severity =
        newStrikeLevel >= 3
          ? 'Suspension / Termination Review (Strike 3)'
          : newStrikeLevel === 2
          ? 'Final Written Warning (Strike 2)'
          : 'Written Warning (Strike 1)';
      const category: WriteUpCategory = tardyInputProtocolType === '30_Min_No_Response' ? 'Failure to Communicate' : 'Excessive Tardiness';
      const autoWriteUp: DisciplinaryWriteUp = {
        id: `wu-tardy-${now}`,
        userId: formData.id,
        userName: formData.name,
        date: todayIsoStr(),
        createdAt: now,
        issuedByManagerId: viewerUser?.id || 'system-attendance',
        issuedByManagerName: viewerUser?.name || 'Clockwork Manager',
        category,
        severity,
        incidentDate: tardyInputDate,
        shiftTitle: shiftLabel,
        description:
          tardyInputProtocolType === '30_Min_No_Response'
            ? `${formData.name} was ${minsLate} minutes late for ${shiftLabel} on ${tardyInputDate} and failed to communicate within 30 minutes of shift start.`
            : `${formData.name} clocked in ${minsLate} minutes late for ${shiftLabel} on ${tardyInputDate}, reaching ${newTardyCount30d} tardies in the rolling 30-day period (${severity}).`,
        correctiveActionPlan:
          'Employee must arrive and clock in on time for all scheduled shifts and respond immediately to the 5-minute tardy check-in DM if delayed.',
        status: 'Pending Signature',
        autoGenerated: true,
      };
      nextWriteUps = [autoWriteUp, ...nextWriteUps];
    }

    const updatedUser: User = {
      ...formData,
      lateDays: (formData.lateDays || 0) + 1,
      tardyCount30Days: newTardyCount30d,
      strikeLevel: newStrikeLevel,
      attendanceAuditLog: nextAuditLogs,
      disciplinaryWriteUps: nextWriteUps,
    };
    persistUserUpdate(updatedUser);

    setTardyInputShiftTitle('');
    setTardyInputNotes('');
  };

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
        import('../services/firebaseService').then(({ firebaseSaveTimeCard, isFirebaseConfigured }) => {
          if (isFirebaseConfigured() && !String(updated.id).startsWith('active-')) {
            firebaseSaveTimeCard(updated).catch(() => {});
          }
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
        import('../services/firebaseService').then(({ firebaseSaveTimeCard, isFirebaseConfigured }) => {
          if (isFirebaseConfigured() && !String(updated.id).startsWith('active-')) {
            firebaseSaveTimeCard(updated).catch(() => {});
          }
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

  const isActualViewerAdmin = React.useMemo(() => {
    if (viewerUser) {
      return viewerUser.role?.trim().toLowerCase() === 'admin' || viewerPerms.includes('admin');
    }
    return isViewerAdmin;
  }, [viewerUser, viewerPerms, isViewerAdmin]);

  const isActualViewerManager = React.useMemo(() => {
    if (isActualViewerAdmin) return true;
    if (!viewerUser) return false;
    const roleLower = viewerUser.role?.trim().toLowerCase() || '';
    if (roleLower === 'manager') return true;
    const managerPermIds = ['manage_team', 'manage_users', 'edit_timecards', 'approve_timecards', 'manage_schedule', 'create_tasks', 'view_reports'];
    return viewerPerms.some(p => managerPermIds.includes(p));
  }, [viewerUser, viewerPerms, isActualViewerAdmin]);

  const isTargetAdmin = React.useMemo(() => {
    if (!formData) return false;
    const targetPerms = Array.isArray(formData.permissions) ? formData.permissions : [];
    return formData.role?.trim().toLowerCase() === 'admin' || targetPerms.includes('admin');
  }, [formData]);

  const isTargetManager = React.useMemo(() => {
    if (!formData) return false;
    return formData.role?.trim().toLowerCase() === 'manager';
  }, [formData]);

  const viewerHasPermission = (permId: string) => {
    if (isActualViewerAdmin) return true;
    if (viewerUser?.role?.trim().toLowerCase() === 'manager') {
      const fullManagerPerms = ['manage_team', 'manage_users', 'edit_timecards', 'approve_timecards', 'manage_schedule', 'create_tasks', 'view_reports', 'manage_permissions'];
      if (fullManagerPerms.includes(permId)) return true;
    }
    return viewerPerms.includes(permId);
  };

  // Admin has full access to ALL individuals (including admins, managers, and team members).
  // Anyone labeled manager has full access to all team members NOT labeled manager or admin.
  const canManageTarget = isActualViewerAdmin || (isActualViewerManager && !isTargetAdmin && !isTargetManager);
  const canEditPermissions = isActualViewerAdmin || (canManageTarget && viewerHasPermission('manage_permissions'));

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
    if (!isActualViewerAdmin && (permId === 'admin' || permId === 'view_payroll')) return;

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
              {!isTargetAdmin && canManageTarget && (
                <label className="inline-flex items-center gap-2 mt-1.5 cursor-pointer select-none text-xs font-semibold text-zinc-100 hover:text-white">
                  <input
                    type="checkbox"
                    checked={formData.isActive !== false}
                    onChange={e => {
                      const updated: User = { ...formData, isActive: e.target.checked };
                      setFormData(updated);
                      if (onQuickUpdate) {
                        onQuickUpdate(updated);
                      } else {
                        import('../services/firebaseService').then(({ firebaseSaveUser, isFirebaseConfigured }) => {
                          if (isFirebaseConfigured()) {
                            firebaseSaveUser(updated).catch(console.error);
                          }
                        });
                      }
                    }}
                    className="h-4 w-4 rounded border-white/40 accent-emerald-500 cursor-pointer"
                  />
                  <span>Active</span>
                </label>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Split Top Layout: Left = Personal Information, Right = Work Information */}
          <div className={`grid grid-cols-1 ${canManageTarget ? 'lg:grid-cols-2' : ''} gap-8`}>
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

            {/* Work Information - Visible when viewer can manage target (Admin for all individuals; Manager for non-manager/non-admin team members) */}
            {canManageTarget && (
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
                        if (!isActualViewerAdmin && val.trim().toLowerCase() === 'admin') {
                          return;
                        }
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
                        if (val.trim().toLowerCase() === 'admin' && isActualViewerAdmin) {
                          perms = AVAILABLE_PERMISSIONS.map(p => p.id);
                        } else if (val.trim().toLowerCase() === 'manager') {
                          const managerPerms = ['manage_users', 'edit_timecards', 'approve_timecards', 'manage_schedule', 'create_tasks', 'view_reports', 'manage_team'];
                          perms = Array.from(new Set([...perms.filter(p => p !== 'admin' && p !== 'view_payroll'), ...managerPerms]));
                        } else if (val.trim().toLowerCase() === 'staff' || val.trim().toLowerCase() === 'terminal') {
                          perms = perms.filter(p => p === 'mobile_clock_in');
                        } else {
                          perms = perms.filter(p => p !== 'admin');
                        }
                        setFormData({ ...formData, role: val, permissions: perms });
                      }}
                      className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-zinc-50"
                      placeholder="e.g. Production Lead, manager, admin"
                    />
                  </div>
                  {isActualViewerAdmin && (
                    <div className="grid grid-cols-2 gap-4">
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
                      <div>
                        <label className="block text-xs font-medium text-zinc-500 mb-1">Compensation Type</label>
                        <select
                          value={formData.compensationType || 'Hourly'}
                          onChange={e => setFormData({ ...formData, compensationType: e.target.value as any })}
                          className="w-full text-sm border-zinc-300 rounded-md focus:ring-zinc-500 focus:border-zinc-300 bg-zinc-50 p-2"
                        >
                          <option value="Hourly">Hourly (Unpaid Leave)</option>
                          <option value="Retainer">Retainer (Retainer Time Off)</option>
                          <option value="Salary">Salary (Retainer Time Off)</option>
                        </select>
                      </div>
                    </div>
                  )}

                </div>

                {/* Review Section */}
                {(() => {
                  const isNearWeekendOrHoliday = (timestamp: number) => {
                    const d = new Date(timestamp);
                    const day = d.getDay();
                    if (day === 0 || day === 1 || day === 5 || day === 6) {
                      const dayNames = ['Sunday', 'Monday', 'Unknown', 'Unknown', 'Unknown', 'Friday', 'Saturday'];
                      return `Weekend (${dayNames[day]})`;
                    }
                    
                    const month = d.getMonth() + 1;
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
                  const userAuditLogs = formData.attendanceAuditLog || [];
                  const userWriteUps = formData.disciplinaryWriteUps || [];
                  
                  const now = Date.now();
                  let rangeDays = 30;
                  if (reviewRange === '60') rangeDays = 60;
                  else if (reviewRange === '90') rangeDays = 90;
                  else if (reviewRange === 'yearly') rangeDays = 365;
                  else if (reviewRange === 'complete') rangeDays = 9999;
                  
                  const rangeStart = rangeDays === 9999 ? 0 : now - rangeDays * 24 * 60 * 60 * 1000;
                  const priorStart = rangeDays === 9999 ? 0 : rangeStart - rangeDays * 24 * 60 * 60 * 1000;
                  const priorEnd = rangeStart;
                  
                  const shiftsWorked = userCards.filter(c => (c.status === 'Complete' || c.status === 'Active') && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                  const sickCards = userCards.filter(c => (c.status === 'Sick' || c.status === 'Emergency') && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                  
                  const getAuditType = (l: any) => l.type || l.eventType;
                  const getAuditDate = (l: any) => l.date || l.dateStr || new Date(l.timestamp).toISOString().split('T')[0];

                  // Link No-Call No-Show cards with Clock-In Tardy Protocol 'No_Call_No_Show' audit logs
                  const rawNoCallCards = userCards.filter(c => c.status === 'No-Call No-Show' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                  const noCallAuditLogs = userAuditLogs.filter(l => getAuditType(l) === 'No_Call_No_Show' && (rangeDays === 9999 ? true : l.timestamp >= rangeStart));
                  const noCallCards = [...rawNoCallCards];
                  noCallAuditLogs.forEach(log => {
                    const logDate = getAuditDate(log);
                    const exists = noCallCards.some(c => (c.date || new Date(c.clockIn).toISOString().split('T')[0]) === logDate);
                    if (!exists) {
                      noCallCards.push({
                        id: log.id,
                        userId: formData.id,
                        date: logDate,
                        clockIn: log.timestamp,
                        status: 'No-Call No-Show',
                        missedShiftTitle: log.shiftTitle || 'Scheduled Shift',
                      });
                    }
                  });

                  // Link Tardy cards with Clock-In Tardy Protocol events ('Late_Clock_In', '5_Min_Tardy_Alert', '30_Min_No_Response')
                  const rawTardyCards = userCards.filter(c => (c.status === 'Complete' || c.status === 'Active') && c.minutesLate && c.minutesLate > 0 && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                  const tardyProtocolLogsInRange = userAuditLogs.filter(
                    l => ['Late_Clock_In', '5_Min_Tardy_Alert', 'Tardy_Response', '30_Min_No_Response'].includes(getAuditType(l)) && (rangeDays === 9999 ? true : l.timestamp >= rangeStart)
                  );
                  const tardyCards = [...rawTardyCards];
                  const tardyDatesSeen = new Set(tardyCards.map(c => c.date || new Date(c.clockIn).toISOString().split('T')[0]));
                  userAuditLogs
                    .filter(l => ['Late_Clock_In', '5_Min_Tardy_Alert', '30_Min_No_Response'].includes(getAuditType(l)) && (rangeDays === 9999 ? true : l.timestamp >= rangeStart))
                    .forEach(log => {
                      const logDate = getAuditDate(log);
                      if (!tardyDatesSeen.has(logDate)) {
                        tardyDatesSeen.add(logDate);
                        const lateLogForDay = userAuditLogs.find(l2 => getAuditType(l2) === 'Late_Clock_In' && getAuditDate(l2) === logDate);
                        const noRespForDay = userAuditLogs.find(l2 => getAuditType(l2) === '30_Min_No_Response' && getAuditDate(l2) === logDate);
                        tardyCards.push({
                          id: log.id,
                          userId: formData.id,
                          date: logDate,
                          clockIn: lateLogForDay?.timestamp || log.timestamp,
                          status: 'Complete',
                          minutesLate: (lateLogForDay as any)?.minutesLate || (noRespForDay ? 30 : (log as any).minutesLate || 5),
                          tardyShiftTitle: lateLogForDay?.shiftTitle || log.shiftTitle || 'Scheduled Shift',
                        });
                      }
                    });
                  tardyCards.sort((a, b) => b.clockIn - a.clockIn);

                  const timeOffRequests = userRequests.filter(req => {
                    const t = req.submittedAt || new Date(req.startDate).getTime();
                    return rangeDays === 9999 ? true : (t >= rangeStart && t < now);
                  });

                  const priorSick = userCards.filter(c => (c.status === 'Sick' || c.status === 'Emergency') && c.clockIn >= priorStart && c.clockIn < priorEnd).length;
                  const priorNoCall = userCards.filter(c => c.status === 'No-Call No-Show' && c.clockIn >= priorStart && c.clockIn < priorEnd).length;
                  const priorTardys = userCards.filter(c => (c.status === 'Complete' || c.status === 'Active') && c.minutesLate && c.minutesLate > 0 && c.clockIn >= priorStart && c.clockIn < priorEnd).length;
                  const priorTimeOff = userRequests.filter(req => {
                    const t = req.submittedAt || new Date(req.startDate).getTime();
                    return t >= priorStart && t < priorEnd;
                  }).length;

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
                      const uSick = uCards.filter(c => (c.status === 'Sick' || c.status === 'Emergency') && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
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

                  const userSickRate = shiftsWorked + sickCards.length > 0 ? sickCards.length / (shiftsWorked + sickCards.length) : 0;
                  const userTardyRate = shiftsWorked > 0 ? tardyCards.length / shiftsWorked : 0;
                  const userNoCallRate = shiftsWorked + noCallCards.length > 0 ? noCallCards.length / (shiftsWorked + noCallCards.length) : 0;
                  const userTimeOffRate = shiftsWorked + timeOffRequests.length > 0 ? timeOffRequests.length / (shiftsWorked + timeOffRequests.length) : 0;

                  const reliabilityCalculations = (() => {
                    const teamUserIds = users.length > 0 ? users.map(u => u.id) : Array.from(new Set(localTimeCards.map(c => c.userId)));
                    let teamTotalShifts = 0;
                    let teamTotalNoCallPoints = 0;
                    let teamTotalSickPoints = 0;
                    let teamTotalTardyPoints = 0;
                    let teamTotalTimeOffPoints = 0;

                    teamUserIds.forEach(uid => {
                      const uCards = localTimeCards.filter(c => c.userId === uid);
                      const uShifts = uCards.filter(c => c.status === 'Complete' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                      
                      const uNoShowsCount = uCards.filter(c => c.status === 'No-Call No-Show' && (rangeDays === 9999 ? true : c.clockIn >= rangeStart)).length;
                      const uNoShowPoints = uNoShowsCount * RELIABILITY_CONFIG.weights.noCallShow;

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

                      let uTardyPoints = 0;
                      const uTardyCards = uCards.filter(c => c.status === 'Complete' && c.minutesLate && c.minutesLate > 0 && (rangeDays === 9999 ? true : c.clockIn >= rangeStart));
                      uTardyCards.forEach(c => {
                        const mins = c.minutesLate || 0;
                        uTardyPoints += Math.min(10, Math.ceil(mins / 5)) * RELIABILITY_CONFIG.weights.tardyPer5Min;
                      });

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

                    const getComparisonFactor = (userRate: number, teamRate: number) => {
                      return Math.min(2.0, Math.max(0.5, (userRate + 0.5) / (teamRate + 0.5)));
                    };

                    const C_noshow = getComparisonFactor(R_user_noshow, R_team_noshow);
                    const C_sick = getComparisonFactor(R_user_sick, R_team_sick);
                    const C_tardy = getComparisonFactor(R_user_tardy, R_team_tardy);
                    const C_timeoff = getComparisonFactor(R_user_timeoff, R_team_timeoff);

                    const noCallDeduction = userNoShowRaw * (10 / S_user) * C_noshow;
                    const sickDeduction = userSickRaw * (10 / S_user) * C_sick;
                    const tardyDeduction = userTardyRaw * (10 / S_user) * C_tardy;
                    const timeOffDeduction = userTimeOffRaw * (10 / S_user) * C_timeoff;

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

                  const getTrendIndicator = (current: number, prior: number) => {
                    if (rangeDays === 9999) return null;
                    if (prior === 0) {
                      return current === 0 ? null : { text: `+${current}`, isWorse: true };
                    }
                    const pct = Math.round(((current - prior) / prior) * 100);
                    if (pct === 0) return null;
                    return {
                      text: pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`,
                      isWorse: pct > 0
                    };
                  };

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
                    <div className="mt-6">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-2 mb-3">
                        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                          <ClipboardCheck className="w-4 h-4 text-zinc-500" /> Review
                        </h4>
                        <div className="flex border border-zinc-200 rounded-lg overflow-hidden w-fit bg-white shadow-sm">
                          {(['30', '60', '90', 'yearly', 'complete'] as const).map(range => (
                            <button
                              key={range}
                              type="button"
                              onClick={() => {
                                setReviewRange(range);
                                setActiveDrilldown(null);
                              }}
                              className={`px-2.5 py-1 text-[10px] font-bold transition-colors ${
                                reviewRange === range
                                  ? 'bg-zinc-900 text-white'
                                  : 'text-zinc-600 hover:bg-zinc-50'
                              }`}
                            >
                              {range === '30' && '30 Days'}
                              {range === '60' && '60 Days'}
                              {range === '90' && '90 Days'}
                              {range === 'yearly' && 'Yearly'}
                              {range === 'complete' && 'All'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4 pl-6">
                        {/* Reliability Banner */}
                        <div className="bg-zinc-900 text-white border border-zinc-800 rounded-xl p-4 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 shadow-md">
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Reliability</span>
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="text-2xl font-extrabold">{reliabilityCalculations.score}/100</span>
                              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${reliabilityCalculations.ratingColor.replace('bg-', 'bg-white/10 ').replace('text-', 'text-')}`}>
                                {reliabilityCalculations.rating}
                              </span>
                              {shiftsWorked < RELIABILITY_CONFIG.thresholds.lowSampleSizeShifts && (
                                <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35 px-2 py-0.5 rounded-full shrink-0 animate-pulse">
                                  ⚠ Limited data ({shiftsWorked} shifts)
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-400 pt-0.5 leading-snug">
                              Weighted score based on punctuality, undocumented sick absences, and unplanned time off.
                            </p>
                          </div>
                          
                          {/* Mini breakdown of deductions & shift count */}
                          <div className="flex gap-3 shrink-0 text-center text-xs border-t xl:border-t-0 xl:border-l border-zinc-800 pt-2.5 xl:pt-0 xl:pl-4 w-full xl:w-auto justify-between xl:justify-end">
                            <div className="border-r border-zinc-800 pr-3">
                              <div className="text-[9px] text-zinc-300 font-bold uppercase">Shifts</div>
                              <div className="font-bold text-zinc-300">{shiftsWorked}</div>
                            </div>
                            <div>
                              <div className="text-[9px] text-zinc-500 font-bold uppercase">No-Show</div>
                              <div className={`font-semibold ${reliabilityCalculations.deductions.noCall > 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                                -{reliabilityCalculations.deductions.noCall}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-zinc-500 font-bold uppercase">Sick</div>
                              <div className={`font-semibold ${reliabilityCalculations.deductions.sick > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                                -{reliabilityCalculations.deductions.sick}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-zinc-500 font-bold uppercase">Tardy</div>
                              <div className={`font-semibold ${reliabilityCalculations.deductions.tardy > 0 ? 'text-indigo-400' : 'text-zinc-500'}`}>
                                -{reliabilityCalculations.deductions.tardy}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] text-zinc-500 font-bold uppercase">Time Off</div>
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
                              <div key={index} className="bg-rose-50/80 border border-rose-200/60 rounded-xl p-2.5 text-xs text-rose-800 flex items-start gap-2 animate-in slide-in-from-top-1">
                                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                <span className="font-semibold leading-normal">{banner}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Metric Grid (Clickable for Managers/Admins to Input & Review) */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {/* Sick / Family Emergency Call-Ins Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'sick' ? null : 'sick')}
                            className={`bg-white border rounded-xl p-3 flex flex-col justify-between min-h-[96px] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'sick' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-1">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Sick Call-ins</span>
                              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            </div>
                            <div className="mt-1.5 flex items-baseline justify-between">
                              <span className="text-xl font-black text-zinc-900">{sickCards.length}</span>
                              {(() => {
                                const trend = getTrendIndicator(sickCards.length, priorSick);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-1.5 text-[9px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{sickCards.length} / {shiftsWorked} shifts</div>
                              <div className={`font-medium truncate ${userSickRate > teamStats.sickRate ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userSickRate, teamStats.sickRate)}
                              </div>
                            </div>
                          </div>

                          {/* Time Off Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'timeOff' ? null : 'timeOff')}
                            className={`bg-white border rounded-xl p-3 flex flex-col justify-between min-h-[96px] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'timeOff' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-1">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Time Off</span>
                              <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            </div>
                            <div className="mt-1.5 flex items-baseline justify-between">
                              <span className="text-xl font-black text-zinc-900">{timeOffRequests.length}</span>
                              {(() => {
                                const trend = getTrendIndicator(timeOffRequests.length, priorTimeOff);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-1.5 text-[9px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{timeOffRequests.length} / {shiftsWorked} shifts</div>
                              <div className={`font-medium truncate ${userTimeOffRate > teamStats.timeOffRate ? 'text-zinc-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userTimeOffRate, teamStats.timeOffRate)}
                              </div>
                            </div>
                          </div>

                          {/* No Call Shows Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'noCall' ? null : 'noCall')}
                            className={`bg-white border rounded-xl p-3 flex flex-col justify-between min-h-[96px] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'noCall' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-1">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">No Call Shows</span>
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            </div>
                            <div className="mt-1.5 flex items-baseline justify-between">
                              <span className="text-xl font-black text-zinc-900">{noCallCards.length}</span>
                              {(() => {
                                const trend = getTrendIndicator(noCallCards.length, priorNoCall);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-1.5 text-[9px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{noCallCards.length} / {shiftsWorked} shifts</div>
                              <div className={`font-medium truncate ${userNoCallRate > teamStats.noCallRate ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userNoCallRate, teamStats.noCallRate)}
                              </div>
                            </div>
                          </div>

                          {/* Tardys Card */}
                          <div
                            onClick={() => setActiveDrilldown(activeDrilldown === 'tardy' ? null : 'tardy')}
                            className={`bg-white border rounded-xl p-3 flex flex-col justify-between min-h-[96px] hover:border-zinc-400 cursor-pointer shadow-sm transition-all relative select-none ${
                              activeDrilldown === 'tardy' ? 'ring-2 ring-zinc-950 border-transparent bg-zinc-50/20' : 'border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-1">
                              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Tardys</span>
                              <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            </div>
                            <div className="mt-1.5 flex items-baseline justify-between">
                              <span className="text-xl font-black text-zinc-900">{tardyCards.length}</span>
                              {(() => {
                                const trend = getTrendIndicator(tardyCards.length, priorTardys);
                                if (!trend) return null;
                                return (
                                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                    trend.isWorse ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    {trend.text.startsWith('↑') ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                                    {trend.text.replace(/[↑↓\s]/g, '')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="mt-1.5 text-[9px] text-zinc-500 space-y-0.5 leading-tight">
                              <div className="font-semibold">{tardyCards.length} / {shiftsWorked} shifts</div>
                              <div className={`font-medium truncate ${userTardyRate > teamStats.tardyRate ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {getBaselineDiffText(userTardyRate, teamStats.tardyRate)}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Active Drilldown & Input Section */}
                        {activeDrilldown && (
                          <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-inner mt-2 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
                            {activeDrilldown === 'sick' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Sick / Family Emergency Call-Ins ({sickCards.length} instances)</h5>
                                  <span className="text-[10px] text-zinc-400 font-semibold italic">Log call-ins & documentation</span>
                                </div>

                                {canManageTarget && (
                                  <div className="p-3 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-2.5">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                                      <Plus className="w-3.5 h-3.5 text-amber-600" />
                                      Input Sick or Family Emergency Call-In
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Call-In Type</label>
                                        <select
                                          value={sickInputType}
                                          onChange={e => setSickInputType(e.target.value as 'Sick' | 'Emergency')}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        >
                                          <option value="Sick">Sick Call-In</option>
                                          <option value="Emergency">Family Emergency</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Date</label>
                                        <input
                                          type="date"
                                          value={sickInputDate}
                                          onChange={e => setSickInputDate(e.target.value)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div className="flex items-end pb-1">
                                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-zinc-700">
                                          <input
                                            type="checkbox"
                                            checked={sickInputDocProvided}
                                            onChange={e => setSickInputDocProvided(e.target.checked)}
                                            className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                                          />
                                          <span>Doctor's Note / Proof Provided</span>
                                        </label>
                                      </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <input
                                        type="text"
                                        value={sickInputNotes}
                                        onChange={e => setSickInputNotes(e.target.value)}
                                        placeholder="Notes (e.g., Called at 7:45 AM regarding illness / family emergency)..."
                                        className="flex-1 text-xs border border-zinc-300 rounded-lg py-1.5 px-2.5 bg-white"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleLogSickOrEmergency}
                                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-white shadow-sm transition-colors shrink-0 flex items-center justify-center gap-1"
                                      >
                                        <Plus className="w-3.5 h-3.5" /> Log Call-In
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {sickCards.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No sick or family emergency call-ins logged for this period.</p>
                                ) : (
                                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                                    {sickCards.map(card => {
                                      const proxy = isNearWeekendOrHoliday(card.clockIn);
                                      return (
                                        <div key={card.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-zinc-50 border border-zinc-150 rounded-lg hover:bg-zinc-100/55 transition-colors">
                                          <div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-bold text-zinc-800">
                                                {new Date(card.clockIn).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                              </span>
                                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                                card.status === 'Emergency'
                                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                                              }`}>
                                                {card.status === 'Emergency' ? 'Family Emergency' : 'Sick Call-In'}
                                              </span>
                                            </div>
                                            {card.managerNotes && <div className="text-[10px] text-zinc-500 italic mt-0.5">Note: "{card.managerNotes}"</div>}
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            {proxy && (
                                              <span className="text-[9px] font-bold bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                                                ⚠️ {proxy}
                                              </span>
                                            )}
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

                            {activeDrilldown === 'timeOff' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Time Off Requests Log ({timeOffRequests.length} instances)</h5>
                                  <span className="text-[10px] text-zinc-400 font-semibold italic">Input or manage time off requests</span>
                                </div>

                                {canManageTarget && (
                                  <div className="p-3 bg-blue-50/50 border border-blue-200/80 rounded-xl space-y-2.5">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                                      <Plus className="w-3.5 h-3.5 text-blue-600" />
                                      Input Time Off Request
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Start Date</label>
                                        <input
                                          type="date"
                                          value={timeOffStartDate}
                                          onChange={e => {
                                            setTimeOffStartDate(e.target.value);
                                            if (timeOffEndDate < e.target.value) setTimeOffEndDate(e.target.value);
                                          }}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">End Date</label>
                                        <input
                                          type="date"
                                          value={timeOffEndDate}
                                          min={timeOffStartDate}
                                          onChange={e => setTimeOffEndDate(e.target.value)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Category</label>
                                        <select
                                          value={timeOffCategory}
                                          onChange={e => setTimeOffCategory(e.target.value as any)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        >
                                          <option value="Vacation">Vacation</option>
                                          <option value="Personal">Personal</option>
                                          <option value="Sick">Sick</option>
                                          <option value="Emergency">Family Emergency</option>
                                          <option value="Retainer Time Off">Retainer Time Off</option>
                                          <option value="Unpaid Leave">Unpaid Leave</option>
                                          <option value="Bereavement">Bereavement</option>
                                          <option value="Other">Other</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Status</label>
                                        <select
                                          value={timeOffStatus}
                                          onChange={e => setTimeOffStatus(e.target.value as any)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        >
                                          <option value="Approved">Approved</option>
                                          <option value="Pending">Pending</option>
                                          <option value="Denied">Denied</option>
                                        </select>
                                      </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-zinc-700 shrink-0">
                                        <input
                                          type="checkbox"
                                          checked={timeOffInAdvance}
                                          onChange={e => setTimeOffInAdvance(e.target.checked)}
                                          className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span>Advance Notice Provided</span>
                                      </label>
                                      <input
                                        type="text"
                                        value={timeOffReason}
                                        onChange={e => setTimeOffReason(e.target.value)}
                                        placeholder="Reason / details..."
                                        className="flex-1 text-xs border border-zinc-300 rounded-lg py-1.5 px-2.5 bg-white"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleLogTimeOffRequest}
                                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-white shadow-sm transition-colors shrink-0 flex items-center justify-center gap-1"
                                      >
                                        <Plus className="w-3.5 h-3.5" /> Log Time Off
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {timeOffRequests.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No time off requests recorded for this period.</p>
                                ) : (
                                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                                    {timeOffRequests.map(req => {
                                      const isPlanned = req.requestedInAdvance !== false;
                                      return (
                                        <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-zinc-50 border border-zinc-150 rounded-lg">
                                          <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-xs font-bold text-zinc-850">
                                                {new Date(req.startDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                {req.startDate !== req.endDate && ` - ${new Date(req.endDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
                                              </span>
                                              <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 tracking-wider">
                                                {req.category || 'Vacation'}
                                              </span>
                                              {canManageTarget ? (
                                                <select
                                                  value={req.status}
                                                  onChange={e => handleUpdateTimeOffStatus(req.id, e.target.value as any)}
                                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border cursor-pointer ${
                                                    req.status === 'Approved'
                                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                      : req.status === 'Pending'
                                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                      : 'bg-red-50 text-red-700 border-red-200'
                                                  }`}
                                                >
                                                  <option value="Approved">Approved</option>
                                                  <option value="Pending">Pending</option>
                                                  <option value="Denied">Denied</option>
                                                </select>
                                              ) : (
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                                  req.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : req.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                                                }`}>
                                                  {req.status}
                                                </span>
                                              )}
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

                            {activeDrilldown === 'noCall' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">No Call Shows Log ({noCallCards.length} instances)</h5>
                                  <span className="text-[10px] text-zinc-400 font-semibold italic">Log coverage & protocol write-ups</span>
                                </div>

                                {canManageTarget && (
                                  <div className="p-3 bg-red-50/50 border border-red-200/80 rounded-xl space-y-2.5">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-red-900 flex items-center gap-1.5">
                                      <Plus className="w-3.5 h-3.5 text-red-600" />
                                      Input No-Call No-Show
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Date</label>
                                        <input
                                          type="date"
                                          value={noCallInputDate}
                                          onChange={e => setNoCallInputDate(e.target.value)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Missed Shift</label>
                                        <input
                                          type="text"
                                          value={noCallInputShiftTitle}
                                          onChange={e => setNoCallInputShiftTitle(e.target.value)}
                                          placeholder="e.g. Morning Production Shift"
                                          className="w-full text-xs border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Covered By</label>
                                        <select
                                          value={noCallInputCoveredBy}
                                          onChange={e => setNoCallInputCoveredBy(e.target.value)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        >
                                          <option value="">No cover logged</option>
                                          {users.filter(u => u.id !== formData.id).map(u => (
                                            <option key={u.id} value={u.id}>Covered by {u.name}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <input
                                        type="text"
                                        value={noCallInputNotes}
                                        onChange={e => setNoCallInputNotes(e.target.value)}
                                        placeholder="Notes (auto-generates Pending Signature Write-Up & Audit entry)..."
                                        className="flex-1 text-xs border border-zinc-300 rounded-lg py-1.5 px-2.5 bg-white"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleLogNoCallNoShow}
                                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors shrink-0 flex items-center justify-center gap-1"
                                      >
                                        <Plus className="w-3.5 h-3.5" /> Log No-Call No-Show
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {noCallCards.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No-shows logged for this period.</p>
                                ) : (
                                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                                    {noCallCards.map(card => {
                                      const cardDateStr = card.date || new Date(card.clockIn).toISOString().split('T')[0];
                                      const linkedWriteUp = userWriteUps.find(w => w.incidentDate === cardDateStr);
                                      return (
                                        <div key={card.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-zinc-50 border border-zinc-150 rounded-lg hover:bg-zinc-100/55 transition-colors">
                                          <div>
                                            <div className="text-xs font-bold text-zinc-800">{new Date(card.clockIn).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                            <div className="text-[10px] text-red-500 font-bold mt-0.5">Missed Shift: {card.missedShiftTitle || 'Not specified'}</div>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            <span className="text-[10px] text-zinc-500 font-semibold">Coverage:</span>
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
                                            {linkedWriteUp ? (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setSelectedWriteUp(linkedWriteUp);
                                                  setShowWriteUpModal(true);
                                                }}
                                                className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border transition-colors ${
                                                  linkedWriteUp.status === 'Pending Signature'
                                                    ? 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200'
                                                    : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                                }`}
                                              >
                                                {linkedWriteUp.status === 'Pending Signature' ? '✍️ Sign Write-Up' : '✓ Signed Write-Up'}
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setSelectedWriteUp(null);
                                                  setInitialWriteUpCategory('No-Call No-Show');
                                                  setInitialWriteUpIncidentDate(cardDateStr);
                                                  setInitialWriteUpShiftTitle(card.missedShiftTitle || 'Scheduled Shift');
                                                  setInitialWriteUpDescription(`Employee did not arrive or communicate for scheduled shift (${card.missedShiftTitle || 'Scheduled Shift'}) on ${cardDateStr}.`);
                                                  setShowWriteUpModal(true);
                                                }}
                                                className="px-2 py-0.5 rounded text-[9px] font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors"
                                              >
                                                + Issue Write-Up
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            {activeDrilldown === 'tardy' && (
                              <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                                  <h5 className="text-xs font-bold text-zinc-700 uppercase tracking-wider">Tardys & Protocol Log ({tardyCards.length} instances)</h5>
                                  <span className="text-[10px] text-zinc-400 font-semibold italic">Linked to Clock-In Tardy Protocol</span>
                                </div>

                                {canManageTarget && (
                                  <div className="p-3 bg-indigo-50/50 border border-indigo-200/80 rounded-xl space-y-2.5">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                                      <Plus className="w-3.5 h-3.5 text-indigo-600" />
                                      Input Tardy (Linked to Clock-In Tardy Protocol)
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Date</label>
                                        <input
                                          type="date"
                                          value={tardyInputDate}
                                          onChange={e => setTardyInputDate(e.target.value)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Minutes Late</label>
                                        <input
                                          type="number"
                                          min="1"
                                          value={tardyInputMinutes}
                                          onChange={e => setTardyInputMinutes(e.target.value)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Shift Title</label>
                                        <input
                                          type="text"
                                          value={tardyInputShiftTitle}
                                          onChange={e => setTardyInputShiftTitle(e.target.value)}
                                          placeholder="e.g. Morning Shift"
                                          className="w-full text-xs border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-zinc-500 uppercase mb-0.5">Protocol Status</label>
                                        <select
                                          value={tardyInputProtocolType}
                                          onChange={e => setTardyInputProtocolType(e.target.value as any)}
                                          className="w-full text-xs font-semibold border border-zinc-300 rounded-lg py-1.5 px-2 bg-white"
                                        >
                                          <option value="Late_Clock_In">Late Clock-In (Communicated)</option>
                                          <option value="5_Min_Tardy_Alert">5-Min Tardy Alert Sent</option>
                                          <option value="30_Min_No_Response">30+ Min Late (No Response)</option>
                                        </select>
                                      </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <input
                                        type="text"
                                        value={tardyInputNotes}
                                        onChange={e => setTardyInputNotes(e.target.value)}
                                        placeholder="Reason / DM reply note..."
                                        className="flex-1 text-xs border border-zinc-300 rounded-lg py-1.5 px-2.5 bg-white"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleLogTardy}
                                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors shrink-0 flex items-center justify-center gap-1"
                                      >
                                        <Plus className="w-3.5 h-3.5" /> Log Tardy
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {tardyCards.length === 0 && tardyProtocolLogsInRange.length === 0 ? (
                                  <p className="text-xs text-zinc-400 italic">No tardy clock-ins or protocol alerts logged for this period.</p>
                                ) : (
                                  <div className="space-y-3">
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
                                        <div className="p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-lg text-[11px] text-indigo-950 space-y-1">
                                          <div className="font-bold flex items-center gap-1">
                                            <AlertCircle className="w-3.5 h-3.5 text-indigo-600" />
                                            Punctuality Cluster Alert
                                          </div>
                                          {peakDays.length > 0 && <div>• Repeated tardiness clustered on: <span className="font-bold">{peakDays.join(', ')}s</span>.</div>}
                                          {peakShifts.length > 0 && <div>• Repeated tardiness clustered during: <span className="font-bold">{peakShifts.join(', ')}</span>.</div>}
                                        </div>
                                      );
                                    })()}
                                    
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                      {tardyCards.map(card => {
                                        const isHighTardy = (card.minutesLate || 0) >= 30;
                                        const isMidTardy = (card.minutesLate || 0) > 10 && (card.minutesLate || 0) < 30;
                                        const cardDateStr = card.date || new Date(card.clockIn).toISOString().split('T')[0];
                                        const dayProtocolLogs = userAuditLogs.filter(
                                          l => getAuditDate(l) === cardDateStr
                                        );
                                        const has5MinAlert = dayProtocolLogs.some(l => getAuditType(l) === '5_Min_Tardy_Alert');
                                        const dmResponseLog = dayProtocolLogs.find(l => getAuditType(l) === 'Tardy_Response');
                                        const has30MinNoResp = dayProtocolLogs.some(l => getAuditType(l) === '30_Min_No_Response');
                                        const linkedWriteUp = userWriteUps.find(w => w.incidentDate === cardDateStr);
                                        
                                        return (
                                          <div key={card.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-zinc-50 border border-zinc-150 rounded-lg">
                                            <div>
                                              <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="text-xs font-bold text-zinc-800">
                                                  {new Date(card.clockIn).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                                </span>
                                                {has5MinAlert && (
                                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                                    5m Alert Sent
                                                  </span>
                                                )}
                                                {dmResponseLog && (
                                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                    DM Replied{dmResponseLog.responseLatencyMinutes !== undefined ? ` (${dmResponseLog.responseLatencyMinutes}m)` : ''}
                                                  </span>
                                                )}
                                                {has30MinNoResp && (
                                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                                                    30m No Response
                                                  </span>
                                                )}
                                              </div>
                                              <div className="text-[10px] text-zinc-500 mt-0.5">
                                                Shift: {card.tardyShiftTitle || 'Not specified'}
                                                {(dmResponseLog?.responseMessage || (dmResponseLog as any)?.responseText) && (
                                                  <span className="ml-2 italic text-zinc-600">• Reply: "{dmResponseLog?.responseMessage || (dmResponseLog as any)?.responseText}"</span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="shrink-0 flex flex-wrap items-center gap-1.5">
                                              <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                                                isHighTardy
                                                  ? 'bg-rose-50 border-rose-200 text-rose-700 font-extrabold'
                                                  : isMidTardy
                                                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                                                  : 'bg-zinc-100 border-zinc-200 text-zinc-650'
                                              }`}>
                                                {card.minutesLate} mins late
                                              </span>
                                              {linkedWriteUp ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setSelectedWriteUp(linkedWriteUp);
                                                    setShowWriteUpModal(true);
                                                  }}
                                                  className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border transition-colors ${
                                                    linkedWriteUp.status === 'Pending Signature'
                                                      ? 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200'
                                                      : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                                  }`}
                                                >
                                                  {linkedWriteUp.status === 'Pending Signature' ? '✍️ Sign Write-Up' : '✓ Signed Write-Up'}
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setSelectedWriteUp(null);
                                                    setInitialWriteUpCategory(has30MinNoResp ? 'Failure to Communicate' : 'Excessive Tardiness');
                                                    setInitialWriteUpIncidentDate(cardDateStr);
                                                    setInitialWriteUpShiftTitle(card.tardyShiftTitle || 'Scheduled Shift');
                                                    setInitialWriteUpDescription(
                                                      has30MinNoResp
                                                        ? `Employee was ${card.minutesLate} minutes late for ${card.tardyShiftTitle || 'scheduled shift'} on ${cardDateStr} and failed to respond to the 5-minute tardy DM check-in within 30 minutes.`
                                                        : `Employee clocked in ${card.minutesLate} minutes late for ${card.tardyShiftTitle || 'scheduled shift'} on ${cardDateStr}.`
                                                    );
                                                    setShowWriteUpModal(true);
                                                  }}
                                                  className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors"
                                                >
                                                  + Write-Up
                                                </button>
                                              )}
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
                    </div>
                  );
                })()}
              </section>
            )}
          </div>

          {/* Remaining sections below the split top layout */}
          {canManageTarget && (
            <>
              {/* Master iPad Digital Write-Ups & Automated Attendance Audit Vault (Manager Only) */}
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-2">
                  <button
                    type="button"
                    onClick={() => setShowWriteUpsDropdown(!showWriteUpsDropdown)}
                    className="flex items-center gap-2 text-left hover:opacity-85 transition-all"
                  >
                    {showWriteUpsDropdown ? (
                      <ChevronDown className="w-4 h-4 text-red-600 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-red-600 shrink-0" />
                    )}
                    <FileWarning className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-xs font-bold text-red-600 uppercase tracking-wider shrink-0">
                      Disciplinary Write-Ups & Tardy Audit Log (Manager Only)
                    </span>
                    {(() => {
                      const pendingCount = (formData.disciplinaryWriteUps || []).filter(
                        w => w.status === 'Pending Signature'
                      ).length;
                      if (pendingCount === 0) return null;
                      return (
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300 rounded-full animate-pulse">
                          ⚠️ {pendingCount} Pending Signature
                        </span>
                      );
                    })()}
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWriteUp(null);
                        setInitialWriteUpCategory('No-Call No-Show');
                        setShowWriteUpModal(true);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors"
                    >
                      + No-Call No-Show
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWriteUp(null);
                        setInitialWriteUpCategory('Failure to Communicate');
                        setShowWriteUpModal(true);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-colors"
                    >
                      + No Communication
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWriteUp(null);
                        setInitialWriteUpCategory('Poor Employee Conduct / Insubordination');
                        setShowWriteUpModal(true);
                      }}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-red-600 hover:bg-red-700 text-white shadow-sm flex items-center gap-1 transition-colors"
                    >
                      <PenTool className="w-3 h-3" /> Issue Digital Write-Up
                    </button>
                  </div>
                </div>

                {showWriteUpsDropdown && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4 bg-red-50/20 border border-red-100 rounded-xl p-4">
                    {/* Left Column: Digital Write-Ups List */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-black uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                          <FileWarning className="w-3.5 h-3.5 text-red-600" />
                          Digital Write-Ups ({(formData.disciplinaryWriteUps || []).length})
                        </h5>
                        <span className="text-[10px] font-bold text-zinc-500">
                          Active Strike Level: {formData.strikeLevel || 0}/3
                        </span>
                      </div>

                      {(formData.disciplinaryWriteUps || []).length === 0 ? (
                        <div className="bg-white border border-zinc-200 rounded-xl p-4 text-center text-xs text-zinc-400 italic">
                          No disciplinary write-ups on file for {formData.name}.
                        </div>
                      ) : (
                        <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                          {(formData.disciplinaryWriteUps || []).map(wu => (
                            <div
                              key={wu.id}
                              className={`p-3 rounded-xl border bg-white shadow-sm flex flex-col justify-between gap-2 ${
                                wu.status === 'Pending Signature'
                                  ? 'border-amber-300 ring-1 ring-amber-200'
                                  : wu.status === 'Refused to Sign'
                                  ? 'border-red-200'
                                  : 'border-zinc-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-black text-zinc-900">
                                      {wu.category}
                                    </span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                                      {wu.severity}
                                    </span>
                                    {wu.autoGenerated && (
                                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                        Auto
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-zinc-500 mt-0.5">
                                    Incident: {wu.incidentDate} • Issued by {wu.issuedByManagerName}
                                  </div>
                                </div>

                                <span
                                  className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                                    wu.status === 'Acknowledged'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : wu.status === 'Refused to Sign'
                                      ? 'bg-red-100 text-red-800 border border-red-300'
                                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                                  }`}
                                >
                                  {wu.status}
                                </span>
                              </div>

                              <p className="text-xs text-zinc-700 line-clamp-2">{wu.description}</p>

                              <div className="flex items-center justify-between pt-1 border-t border-zinc-100">
                                <span className="text-[10px] text-zinc-400">
                                  {wu.employeeSignedAt
                                    ? `Signed ${new Date(wu.employeeSignedAt).toLocaleDateString()}`
                                    : wu.refusedToSign
                                    ? 'Refusal Witnessed'
                                    : 'Awaiting Master iPad Signature'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedWriteUp(wu);
                                    setShowWriteUpModal(true);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 transition-colors ${
                                    wu.status === 'Pending Signature'
                                      ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                                      : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
                                  }`}
                                >
                                  <PenTool className="w-3 h-3" />
                                  {wu.status === 'Pending Signature'
                                    ? 'Review & Sign on iPad'
                                    : 'View Signed Record'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right Column: Automated Attendance & Tardy DM Audit Log */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-black uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-600" />
                          Automated Attendance & Tardy DM Audit Log (
                          {(formData.attendanceAuditLog || []).length})
                        </h5>
                        <span className="text-[10px] text-zinc-400 italic">
                          Auto-logged 5-min alerts & replies
                        </span>
                      </div>

                      {(formData.attendanceAuditLog || []).length === 0 ? (
                        <div className="bg-white border border-zinc-200 rounded-xl p-4 text-center text-xs text-zinc-400 italic">
                          No automated tardy alerts or DM check-in responses recorded yet.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {(formData.attendanceAuditLog || []).map(entry => (
                            <div
                              key={entry.id}
                              className="p-2.5 rounded-xl bg-white border border-zinc-200 text-xs flex flex-col gap-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                    entry.type === 'Tardy_Response'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : entry.type === '30_Min_No_Response' ||
                                        entry.type === 'No_Call_No_Show'
                                      ? 'bg-red-50 text-red-700 border border-red-200'
                                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  }`}
                                >
                                  {entry.type.replace(/_/g, ' ')}
                                </span>
                                <span className="text-[10px] text-zinc-400 font-medium">
                                  {new Date(entry.timestamp).toLocaleString()}
                                </span>
                              </div>
                              <div className="text-zinc-700 font-medium">{entry.details}</div>
                              {entry.responseMessage && (
                                <div className="text-[11px] bg-emerald-50/60 border border-emerald-100 text-emerald-900 px-2.5 py-1 rounded-lg font-semibold">
                                  Reply ({entry.responseLatencyMinutes ?? 0}m after alert): "
                                  {entry.responseMessage}"
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Documents Accordion Section */}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowDocumentsDropdown(!showDocumentsDropdown)}
                  className="w-full flex items-center gap-2 border-b border-zinc-100 pb-2 text-left hover:opacity-85 transition-all"
                >
                  {showDocumentsDropdown ? (
                    <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                  )}
                  <FileText className="w-4 h-4 text-zinc-500 shrink-0" />
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0">
                    Documents ({(formData.onboardingDocuments || []).length})
                  </span>
                </button>

                {showDocumentsDropdown && (
                  <div className="mt-4 bg-zinc-50/30 border border-zinc-200 rounded-lg p-4 animate-in slide-in-from-top-2 duration-200">
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
                )}
              </div>

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
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider shrink-0">Schedule</span>
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

      {showWriteUpModal && formData && (
        <DigitalWriteUpModal
          targetUser={formData}
          currentManager={
            viewerUser || {
              id: 'admin-manager',
              name: 'Manager',
              role: 'admin',
              avatarInitials: 'MG',
              pin: '0000'
            }
          }
          existingWriteUp={selectedWriteUp}
          initialCategory={initialWriteUpCategory}
          initialIncidentDate={initialWriteUpIncidentDate}
          initialShiftTitle={initialWriteUpShiftTitle}
          initialDescription={initialWriteUpDescription}
          onClose={() => {
            setShowWriteUpModal(false);
            setSelectedWriteUp(null);
            setInitialWriteUpIncidentDate(undefined);
            setInitialWriteUpShiftTitle(undefined);
            setInitialWriteUpDescription(undefined);
          }}
          onSaveWriteUp={async updatedUser => {
            setFormData(updatedUser);
            if (onQuickUpdate) {
              onQuickUpdate(updatedUser);
            } else {
              onSave(updatedUser);
            }
          }}
        />
      )}
    </div>
  );
};