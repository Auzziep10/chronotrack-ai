
import { WorkLog, Department } from "../types";

/**
 * GEMINI SERVICE STUBBED FOR STABILITY
 * The AI features are currently disabled to prevent production crashes 
 * while the API key is being configured.
 */

export const generateDailySummary = async (logs: WorkLog[]): Promise<string> => {
  if (logs.length === 0) {
    return "No work logs available to summarize.";
  }

  const totalLogs = logs.length;
  const departments = [...new Set(logs.map(l => l.department))];

  return `📊 Daily Activity Breakdown:
• Total Entries: ${totalLogs}
• Departments Involved: ${departments.join(', ')}

(Note: Advanced AI analysis is currently in Manual Mode. Please configure your VITE_GEMINI_API_KEY in Vercel to re-enable.)`;
};

export const processExternalPlan = async (rawPlanText: string): Promise<string> => {
  return "AI Plan Parsing is currently unavailable. Viewing raw plan data instead:\n\n" + rawPlanText;
};
