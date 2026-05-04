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
    const prompt = `You are an assistant for a manager. Your job is to parse the following messy plain language schedule / external plan text into a structured JSON array of tasks.
Return ONLY valid JSON. Do not include any other text, markdown formatting like \`\`\`json, or explanations. 

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
