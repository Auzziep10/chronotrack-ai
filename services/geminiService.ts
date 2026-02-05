
import { GoogleGenAI } from "@google/genai";
import { WorkLog, Department } from "../types";

// Make API key optional - feature will be disabled if not provided
// Use try-catch to safely access import.meta.env
let API_KEY = '';
try {
  API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
} catch (e) {
  // Running in environment without import.meta.env
}
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

export const generateDailySummary = async (logs: WorkLog[]): Promise<string> => {
  if (logs.length === 0) {
    return "No work logs available to summarize.";
  }

  // If no API key, return a basic summary instead
  if (!ai) {
    const totalLogs = logs.length;
    const departments = [...new Set(logs.map(l => l.department))];
    return `📊 Daily Summary:\n• ${totalLogs} activities logged\n• Departments: ${departments.join(', ')}\n\n(AI summaries require a Gemini API key)`;
  }

  const logsText = logs.map(log => {
    const time = new Date(log.timestamp).toLocaleTimeString();
    let details = `[${time}] Dept: ${log.department} | Task: ${log.task}`;
    if (log.department === Department.Production && log.productionData) {
      details += ` | Project: ${log.productionData.projectName} | Qty: ${log.productionData.quantity}`;
    }
    if (log.notes) {
      details += ` | Notes: ${log.notes}`;
    }
    return details;
  }).join('\n');

  const prompt = `
    You are a professional project manager assistant. 
    Review the following work logs from a team member's day and generate a concise, professional daily summary report.
    Highlight key achievements, total production quantities (if any), and distribution of time across departments.
    
    Work Logs:
    ${logsText}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Could not generate summary.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "An error occurred while communicating with the AI service.";
  }
};

/**
 * Parses raw text from an external Daily Planner (e.g., from Replit)
 * and turns it into a structured set of expected goals.
 */
export const processExternalPlan = async (rawPlanText: string): Promise<string> => {
  if (!ai) {
    return "AI plan processing is not available (no API key configured).";
  }

  const prompt = `
    I have a daily work plan from an external planner tool. 
    Please parse this text and convert it into a structured "Expected Goals" list.
    Categorize tasks by department (Design, Print, Warehousing, Production, Facility, Event).
    Identify any production targets (quantities) mentioned.
    
    Raw Plan Data:
    ${rawPlanText}
    
    Format the output as a clean, structured Markdown report that a manager can use to track shift progress.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Unable to parse the plan.";
  } catch (error) {
    console.error("Gemini Plan Parsing Error:", error);
    return "Error processing external plan data.";
  }
};
