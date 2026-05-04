import { WorkLog, ScheduleBlock, Department } from "../types";
import { getAI, getGenerativeModel } from "firebase/ai";
import { app } from "./firebaseService";

export const generateDailySummary = async (logs: WorkLog[]): Promise<string> => {
  if (logs.length === 0) {
    return "No work logs available to summarize.";
  }

  try {
    const ai = getAI(app);
    const model = getGenerativeModel(ai, { model: "gemini-1.5-flash" });

    const logsContext = logs.map(log => 
      `- Department: ${log.department}, Task: ${log.task}, Notes: ${log.notes || 'None'}, Duration: ${
        Math.round(((log.periodEnd || Date.now()) - (log.periodStart || Date.now())) / 60000)
      } mins`
    ).join("\n");

    const prompt = `You are an HR assistant. Please summarize the following work logs into a concise, professional paragraph highlighting the key achievements and total effort across departments. Make it readable for a manager.\n\nLogs:\n${logsContext}`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error generating daily summary:", error);
    return "Failed to generate AI summary. Please check your Firebase Vertex AI configuration.";
  }
};

export const processExternalPlan = async (rawPlanText: string): Promise<string> => {
  if (!rawPlanText || !rawPlanText.trim()) {
    return "No plan data provided.";
  }

  try {
    const ai = getAI(app);
    const model = getGenerativeModel(ai, { 
        model: "gemini-1.5-flash",
        generationConfig: {
            responseMimeType: "application/json"
        }
    });

    const prompt = `You are an assistant for a manager. Your job is to parse the following messy plain language schedule / external plan text into a structured JSON array of tasks.
Each task object in the array should conform to this schema:
{
  "assignedToName": "The name of the staff member",
  "title": "A short descriptive title for the task",
  "description": "More detailed description, including goals, unit counts, etc.",
  "department": "One of: Design, Print, Warehousing, Production, Facility, Event"
}

Raw Plan Text:
"""
${rawPlanText}
"""
`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error parsing external plan:", error);
    return JSON.stringify({ error: "Failed to parse the plan using AI." });
  }
};
