import { Department, User, DayOfWeek, DailyAvailability } from './types';

// Map departments to their specific tasks
export const DEPARTMENT_TASKS: Record<Department, string[]> = {
  [Department.Design]: [
    'Renders',
    'Tech Packs',
    'Rack Selections',
    'Platform',
    'Web'
  ],
  [Department.Print]: [
    'Maintenance',
    'Supplies',
    'Printing'
  ],
  [Department.Warehousing]: [
    'Inventory',
    'Fullfillment', // Keeping strict to user prompt spelling
    'Shipping',
    'Client Support'
  ],
  [Department.Production]: [
    'Transfers - Cut',
    'Transfers - Applied',
    'Garments Completed'
  ],
  [Department.Facility]: [
    'Cleaning',
    'Building Maintenance',
    'Yard Maintenance'
  ],
  [Department.Event]: [
    'Planning',
    'Setup',
    'Coordination',
    'Teardown'
  ]
};

export const LOG_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
// export const LOG_INTERVAL_MS = 10 * 1000; // Debug: 10 seconds

export const DAYS_OF_WEEK: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Helper for default availability
const createDefaultAvailability = (): Record<DayOfWeek, DailyAvailability> => {
  const avail: any = {};
  DAYS_OF_WEEK.forEach(day => {
    const isWeekend = day === 'Saturday' || day === 'Sunday';
    avail[day] = {
      active: !isWeekend,
      start: '09:00',
      end: '17:00'
    };
  });
  return avail;
};

const defaultAvailability = createDefaultAvailability();

// Initial Users
export const DEFAULT_USERS: User[] = [
  {
    id: 'u1',
    name: 'Alex Johnson',
    role: 'Production Lead',
    primaryDepartment: Department.Production,
    secondaryDepartment: Department.Warehousing,
    supportingRole: 'Backup Forklift Driver',
    avatarInitials: 'AJ',
    pin: '1234',
    email: 'alex.j@company.com',
    phoneNumber: '555-0101',
    address: '123 Maple St, Springfield',
    availability: defaultAvailability,
    lateDays: 0,
    correctionNotes: 'Coached on 10/12 regarding missed scans.'
  },
  {
    id: 'u2',
    name: 'Sarah Connor',
    role: 'Designer',
    primaryDepartment: Department.Design,
    secondaryDepartment: Department.Print,
    supportingRole: 'QC Assistant',
    avatarInitials: 'SC',
    pin: '5678',
    email: 'sarah.c@company.com',
    phoneNumber: '555-0102',
    address: '456 Oak Ave, Springfield',
    availability: defaultAvailability,
    lateDays: 2,
    correctionNotes: ''
  },
  {
    id: 'u3',
    name: 'Mike Ross',
    role: 'Warehouse Manager',
    primaryDepartment: Department.Warehousing,
    secondaryDepartment: Department.Facility,
    supportingRole: 'Safety Officer',
    avatarInitials: 'MR',
    pin: '9012',
    email: 'mike.r@company.com',
    phoneNumber: '555-0103',
    address: '789 Pine Ln, Springfield',
    availability: defaultAvailability,
    lateDays: 1,
    correctionNotes: ''
  },
  {
    id: 'u4',
    name: 'Emily Blunt',
    role: 'Print Specialist',
    primaryDepartment: Department.Print,
    secondaryDepartment: Department.Production,
    supportingRole: 'Packager',
    avatarInitials: 'EB',
    pin: '3456',
    email: 'emily.b@company.com',
    phoneNumber: '555-0104',
    address: '321 Birch Rd, Springfield',
    availability: {
      ...defaultAvailability,
      'Tuesday': { active: true, start: '10:00', end: '18:00' },
      'Wednesday': { active: true, start: '10:00', end: '18:00' },
      'Thursday': { active: true, start: '10:00', end: '18:00' },
      'Friday': { active: true, start: '10:00', end: '18:00' },
      'Saturday': { active: true, start: '10:00', end: '18:00' },
      'Monday': { active: false, start: '09:00', end: '17:00' }
    },
    lateDays: 0,
    correctionNotes: ''
  },
];

export const AVAILABLE_PERMISSIONS = [
  { id: 'admin', label: 'Administrator', description: 'Full system access' },
  { id: 'manage_team', label: 'Manage Team', description: 'Add/Edit users & profiles' },
  { id: 'manage_timecards', label: 'Manage Timecards', description: 'Edit time logs & approve cards' },
  { id: 'view_reports', label: 'View Reports', description: 'Access to productivity & payroll reports' },
  { id: 'manage_settings', label: 'System Settings', description: 'Configure pay periods & app settings' },
  { id: 'mobile_clock_in', label: 'Remote / Mobile Clock-in', description: 'Can clock in/out directly from their personal device' }
];