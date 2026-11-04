import OpenAI from "openai";

type Purpose = "transcribe" | "summary" | "detailed" | "deep" | "chat" | "assessment";
const defaults: Record<Purpose, [string, string]> = {
  transcribe: ["whisper-1", "openai/whisper-1"], summary: ["gpt-4o-mini", "openai/gpt-4o-mini"],
  detailed: ["gpt-4o-mini", "openai/gpt-4o-mini"],
  deep: ["gpt-4o-mini", "openai/gpt-4o-mini"], chat: ["gpt-4o-mini", "openai/gpt-4o-mini"],
  assessment: ["gpt-4o-mini", "openai/gpt-4o-mini"],
};

export class ConfigurationError extends Error {}
export function aiClient(purpose: Purpose) {
  const provider = (process.env[`${purpose.toUpperCase()}_PROVIDER`] || process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  if (provider !== "openai" && provider !== "openrouter") throw new ConfigurationError(`${purpose.toUpperCase()}_PROVIDER must be openai or openrouter.`);
  const keyName = provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  const apiKey = process.env[keyName]?.trim();
  if (!apiKey) throw new ConfigurationError(`Set ${keyName} in .env.local for the ${purpose} provider and restart the server.`);
  const model = process.env[`${purpose.toUpperCase()}_MODEL`]?.trim() || defaults[purpose][provider === "openrouter" ? 1 : 0];
  return { client: new OpenAI({ apiKey, ...(provider === "openrouter" ? { baseURL: "https://openrouter.ai/api/v1" } : {}) }), model };
}

export async function summarize(transcript: string, mode: "brief" | "detailed" | "deep", language = "English") {
  const purpose = mode === "brief" ? "summary" : mode;
  const { client, model } = aiClient(purpose);
  const chunks = Array.from({ length: Math.ceil(transcript.length / 25_000) }, (_, index) => transcript.slice(index * 25_000, (index + 1) * 25_000));
  const languageInstruction = language === "English" ? "Write in English." : `Write the result in ${language}.`;
  const sectionPrompt = mode === "brief"
    ? "Summarize the main points faithfully."
    : "Create detailed study notes from this transcript section. Preserve definitions, reasoning, examples, equations, qualifications and unresolved points. Do not invent facts.";
  const notes = await Promise.all(chunks.map(async (chunk) => (await client.chat.completions.create({ model, messages: [{ role: "system", content: `${sectionPrompt} ${languageInstruction}` }, { role: "user", content: chunk }] })).choices[0].message.content || ""));
  const prompt = mode === "deep"
    ? "Produce an in-depth educational analysis grounded in these notes. Explain concepts, reasoning, connections, examples and limitations. Flag uncertainty and transcription gaps. Use Markdown headings and do not invent details."
    : mode === "detailed"
      ? "Create comprehensive, well-structured study notes based only on these notes. Include sections for Overview, Core concepts and definitions, Step-by-step explanations, Examples or equations, and Important details. Do not invent facts."
      : "Create clear study notes based only on these notes. Use Markdown sections: Overview, Key takeaways, and Important details. Do not invent facts.";
  const mathInstruction = "Use standard Markdown for headings, lists and emphasis. When mathematical notation is helpful, use KaTeX-compatible LaTeX. Every mathematical expression must be fully wrapped: inline math as $...$ (for example, $T_{1/2} = \\frac{\\ln 2}{\\lambda}$) and display equations as $$...$$. Never use \\( ... \\), \\[ ... \\], bare LaTeX commands in prose, or escaped dollar signs. Do not put ordinary prose in math delimiters. Avoid nesting \\frac expressions: if the numerator contains fractions, write the outer division as \\left( ... \\right) / h so fraction bars never visually overlap or cut through the equation.";
  return (await client.chat.completions.create({ model, messages: [{ role: "system", content: `${prompt} ${mathInstruction} ${languageInstruction}` }, { role: "user", content: notes.join("\n\n") }] })).choices[0].message.content || "";
}
