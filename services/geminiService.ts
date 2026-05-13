import { WorkLog, ScheduleBlock, Department } from "../types";

export const generateDailySummary = async (logs: WorkLog[]): Promise<string> => {
  if (logs.length === 0) {
    return "No work logs available to summarize.";
  }

  try {
    const logsContext = logs.map(log => 
      `- Department: ${log.department}, Task: ${log.task}, Notes: ${log.notes || 'None'}, Duration: ${
        Math.round(((log.periodEnd || Date.now()) - (log.periodStart || Date.now())) / 60000)
      } mins`
    ).join("\n");

    const prompt = `You are an HR assistant. Please summarize the following work logs into a concise, professional paragraph highlighting the key achievements and total effort across departments. Make it readable for a manager.\n\nLogs:\n${logsContext}`;

    const apiKey = "AIzaSyDomyUqxHFPOroRAmoeOZC-oFuLuSIcj_E";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
       throw new Error(data.error?.message || "Failed to fetch from Gemini API");
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No summary generated.";
  } catch (error: any) {
    console.error("Error generating daily summary:", error);
    return `Failed to generate AI summary: ${error.message || error}`;
  }
};

export const processExternalPlan = async (rawPlanText: string): Promise<string> => {
  if (!rawPlanText || !rawPlanText.trim()) {
    return "No plan data provided.";
  }

  try {
    const now = new Date();
    const prompt = `You are an assistant for a manager. Your job is to parse the following messy plain language schedule / external plan text into a structured JSON array of tasks.
Return ONLY valid JSON. Do not include any other text, markdown formatting like \`\`\`json, or explanations. 

The current date and time is: ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
If the user says "right now", use the current time rounded to the nearest half hour.
If the user DOES NOT specify any time or duration, DO NOT include the "startTime" or "endTime" fields in the JSON.

CRITICAL RULES FOR MULTIPLE TASKS & TIMES:
1. If a single sentence mentions multiple tasks (e.g., "Kurtis is doing printer maintenance 10-12 and then inventory check at 2"), you MUST split them into multiple separate task objects in the JSON array.
2. Carefully apply the specified or implied times to each distinct task.
3. ALL TIMES MUST BE 24-HOUR FORMAT (HH:mm). 
4. INFER AM/PM CAREFULLY: We work from 6 AM to 8 PM. If the user says "at 2", they mean 2 PM ("14:00"). If they say "1-2", they mean 1 PM to 2 PM ("13:00" to "14:00"). If they say "10-12", they mean 10 AM to 12 PM ("10:00" to "12:00").

Each task object in the array should conform to this schema:
{
  "assignedToName": "The name of the staff member",
  "title": "A short descriptive title for the task",
  "description": "More detailed description, including goals, unit counts, etc.",
  "department": "One of: Design, Print, Warehousing, Production, Facility, Event",
  "startTime": "Start time in 24-hour HH:mm format (ONLY if a time is specified or implied)",
  "endTime": "End time in 24-hour HH:mm format (ONLY if a time is specified or implied)"
}

Raw Plan Text:
"""
${rawPlanText}
"""
`;

    const apiKey = "AIzaSyDomyUqxHFPOroRAmoeOZC-oFuLuSIcj_E";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
       throw new Error(data.error?.message || "Failed to fetch from Gemini API");
    }

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Attempt to extract JSON array using regex if there's markdown or text wrapping
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
        text = match[0];
    }
    
    return text;
  } catch (error: any) {
    console.error("Error parsing external plan:", error);
    return JSON.stringify({ error: `Failed to parse the plan using AI: ${error.message || error}` });
  }
};
