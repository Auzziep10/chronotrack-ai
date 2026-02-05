
import { GoogleGenAI } from "@google/genai";
import { WorkLog, Department } from "../types";

// Always initialize with the named parameter apiKey from process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateDailySummary = async (logs: WorkLog[]): Promise<string> => {
  if (logs.length === 0) {
    return "No work logs available to summarize.";
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
