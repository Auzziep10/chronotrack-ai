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
  // Administration
  {
    id: 'admin',
    label: 'Full Administrator Access',
    description: 'Bypass all checks & grant full system control.',
    category: 'Administration',
    detailedExplanation: 'Gives unrestricted access to the entire system, including editing admin profiles, deleting users, viewing all payroll costs, and changing any application settings.'
  },
  {
    id: 'manage_settings',
    label: 'Manage System Settings',
    description: 'Configure pay periods, app intervals, and integrations.',
    category: 'Administration',
    detailedExplanation: 'Allows changing system settings, configuring pay frequencies, editing clock-in verification intervals, and toggling Discord or email notifications.'
  },
  {
    id: 'mobile_clock_in',
    label: 'Remote / Mobile Clock-in',
    description: 'Clock in/out directly from a personal mobile device.',
    category: 'Administration',
    detailedExplanation: 'Enables the user to clock in/out of their shifts using the Clockwork mobile app on their personal phone, bypassing physical terminal station requirements.'
  },
  // Team Management
  {
    id: 'manage_users',
    label: 'Manage Staff Profiles',
    description: 'Create and update basic employee records.',
    category: 'Team Management',
    detailedExplanation: 'Allows adding new team members, editing employee names, usernames, phone numbers, email addresses, and setting login PINs.'
  },
  {
    id: 'manage_permissions',
    label: 'Assign Roles & Permissions',
    description: 'Grant or revoke Bio-Lock permissions for staff.',
    category: 'Team Management',
    detailedExplanation: 'Allows security management by checking or unchecking permission boxes and editing system roles for other users (except admin privileges unless they are an admin).'
  },
  // Time & Attendance
  {
    id: 'edit_timecards',
    label: 'Edit Timecards & Logs',
    description: 'Modify clock times, log absences, and edit notes.',
    category: 'Time & Attendance',
    detailedExplanation: 'Allows manually correcting clock-in and clock-out timestamps, writing manager context notes, adding retroactive shifts, and logging sick/emergency leave.'
  },
  {
    id: 'approve_timecards',
    label: 'Approve Payroll Hours',
    description: 'Approve timecards to finalize hours for payroll.',
    category: 'Time & Attendance',
    detailedExplanation: 'Allows managers to review work logs, sign off/approve completed timecards, and mark them as ready for payroll export.'
  },
  // Operations
  {
    id: 'manage_schedule',
    label: 'Manage Shift Schedules',
    description: 'Create shift schedules and assign employee shifts.',
    category: 'Operations',
    detailedExplanation: 'Enables access to the Daily Planner tab to create expected shift blocks, adjust shift hours, and manage shift calendar views.'
  },
  {
    id: 'create_tasks',
    label: 'Create & Assign Tasks',
    description: 'Create Quick Tasks and assign them to staff.',
    category: 'Operations',
    detailedExplanation: 'Enables defining Quick Tasks templates, managing orders, and assigning specific tasks to employees on the Daily Planner.'
  },
  // Reporting
  {
    id: 'view_reports',
    label: 'View Labor & Productivity Reports',
    description: 'Access department activity and work hour metrics.',
    category: 'Reporting',
    detailedExplanation: 'Allows viewing performance graphs, department labor hour totals, efficiency metrics, and general activity summaries on the dashboard.'
  },
  {
    id: 'view_payroll',
    label: 'View Pay Rates & Financial Cost',
    description: 'Access pay rates and estimated payroll labor cost.',
    category: 'Reporting',
    detailedExplanation: 'Gives visibility into hourly pay rates on staff profiles and shows total estimated wage costs on department and payroll reports.'
  }
];