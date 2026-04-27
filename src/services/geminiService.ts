import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

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

export async function askGeoBotanico(query: string, contextData: any[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Aqui estão os dados atuais do banco: ${JSON.stringify(contextData)}.
Pergunta do pesquisador: '${query}'`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    return response.text || "Sem resposta do assistente.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Desculpe, tive um erro ao processar sua análise botânica.";
  }
}

export async function analyzeScientificPaper(query: string, paperText: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Com base no seguinte texto científico:
---
${paperText}
---
Assunto: ${query}

Responda de forma técnica e objetiva.`,
      config: {
        systemInstruction: "Aja como um assistente RAG especializado em botânica mineira."
      }
    });

    return response.text || "Erro ao analisar o artigo científico.";
  } catch (error) {
    console.error("Gemini RAG Error:", error);
    return "Erro ao analisar o artigo científico.";
  }
}
