export enum Department {
  Design = 'Design',
  Print = 'Print',
  Warehousing = 'Warehousing',
  Production = 'Production',
  Facility = 'Facility',
  Event = 'Event'
}

export interface ProductionData {
  projectName: string;
  quantity: number;
}

export interface WorkLog {
  id: string;
  userId?: string; // Added for multi-user tracking
  userName?: string; // Added for display
  timestamp: number; // When the log was created
  periodStart: number; // The start of the work hour
  periodEnd: number; // The end of the work hour
  department: Department;
  task: string;
  productionData?: ProductionData; // Only for Production department
  notes?: string;
}

export type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export interface DailyAvailability {
  active: boolean;
  start: string;
  end: string;
}

// Reporting Types
export interface TimeOffRequest {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: 'Pending' | 'Approved' | 'Denied';
  reason: string;
  submittedAt: number;
}

export interface User {
  id: string;
  name: string;
  username?: string; // Mapped from external auth or local auth
  password?: string; // Local auth password
  role: string; // Primary Role
  permissions?: string[]; // RBAC Permissions
  primaryDepartment?: Department;
  secondaryDepartment?: Department;
  supportingRole?: string;
  avatarInitials: string;
  pin: string;
  // Personal Info
  phoneNumber?: string;
  email?: string;
  address?: string;
  discordId?: string;
  discordAlertPrefs?: number[]; // [30, 45, 60]
  // Work Info
  availability: Record<DayOfWeek, DailyAvailability>;
  lateDays?: number;
  correctionNotes?: string;
  timeOffRequests?: TimeOffRequest[];
  onboardingDocuments?: Array<{ id: string, formType: string, url: string, uploadedAt: string, fileName: string }>;
}

export interface UserSession {
  userId: string;
  user: User;
  startTime: number;
  lastLogTime: number;
  logs: WorkLog[];
  isPaused?: boolean;
  pauseReason?: 'lunch' | 'idle';
  currentIdleStartTime?: number | null;
  totalIdleTimeMs?: number;
  clockInDepartment?: string;
  isUnscheduled?: boolean;
}

export interface DailyTimeCard {
  id: string;
  userId: string;
  date: string; // ISO Date string YYYY-MM-DD
  clockIn: number;
  clockOut: number | null;
  totalHours: number;
  totalIdleHours?: number; // Subtracted from total due to missed check-ins
  status: 'Complete' | 'Active' | 'Missing';
  clockInDepartment?: string;
  isUnscheduled?: boolean;
}

// App Configuration
export type PayFrequency = 'Weekly' | 'Bi-Weekly' | 'Monthly';

export interface AppSettings {
  payFrequency: PayFrequency;
  payPeriodStartDay: DayOfWeek;
  checkInIntervalHours?: number;
  autoPauseEnabled?: boolean;
}

export interface ScheduleBlock {
  id: string;
  scheduleId: string;
  assignedTo: string; // userId
  assignedToName?: string; // Mapped for easier display
  title: string;
  description?: string;
  startTime: string; // ISO date string
  endTime: string; // ISO date string
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'delayed';
  location?: string;
  department?: Department;
  checkIns?: Array<{
    id?: string;
    timestamp: any;
    notes?: string;
    status?: string;
    progress?: number;
    userName?: string;
  }>;
  isShiftBlock?: boolean; // Flag to differentiate shift schedules from task blocks
}

export interface DailySchedule {
  id: string;
  date: string; // ISO date string
  summary?: string;
  blocks: ScheduleBlock[];
}