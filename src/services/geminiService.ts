import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `Você é o "GeoBotânico-BH", um assistente de IA especializado em botânica e ecologia urbana em Belo Horizonte. Sua função é interagir com pesquisadores para analisar dados de árvores.

Contexto de Dados: Você receberá entradas que contêm Coordenadas, Tags (Nativa, Exótica, Hospedeira de galha, etc) e Metadados.

Suas Diretrizes:
1. Análise Técnica: Relacione as tags. Se houver "Galha", sugira coletas ambientais.
2. Conhecimento Local: Use o bioma de BH (Transição Cerrado/Mata Atlântica). Mencione se a espécie é adequada ao clima local.
3. Tom: Profissional, acadêmico e colaborativo.
4. Coordenadas: Identifique a região de BH (Centro-Sul, Pampulha, Venda Nova).
5. Formatação: Use tabelas e listas.

Restrições:
- Não invente dados.
- Peça detalhes morfológicos se houver incerteza.`;

// The platform provides process.env.GEMINI_API_KEY in the preview environment.
const ai = new GoogleGenAI({ 
  apiKey: 
    process.env.USER_GEMINI_KEY || 
    process.env.GEMINI_API_KEY || 
    (import.meta as any).env?.VITE_USER_GEMINI_KEY ||
    (import.meta as any).env?.VITE_GEMINI_API_KEY ||
    "" 
});

export async function askGeoBotanico(query: string, contextData: any[]) {
  try {
    const prompt = `Pergunta do Pesquisador: ${query}\n\nDados Botânicos: ${JSON.stringify(contextData)}`;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    return response.text || "Sem resposta do GeoBotânico.";
  } catch (error: any) {
    console.error("Gemini Service Error:", error);
    return `Erro na IA: ${error.message || "Falha na geração"}`;
  }
}

export async function analyzeScientificPaper(query: string, paperText: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Conteúdo do Artigo: ${paperText}\n\nPergunta: ${query}`,
      config: {
        systemInstruction: "Aja como um assistente RAG especializado em botânica mineira. Responda de forma técnica e objetiva."
      }
    });

    return response.text || "Erro ao analisar o artigo.";
  } catch (error: any) {
    console.error("Gemini Paper Error:", error);
    return `Erro ao processar o artigo: ${error.message}`;
  }
}
