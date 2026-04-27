export async function askGeoBotanico(query: string, contextData: any[]) {
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, contextData }),
    });

    if (!response.ok) throw new Error("Erro na comunicação com o servidor");
    const data = await response.json();
    return data.response || "Sem resposta do assistente.";
  } catch (error) {
    console.error("Gemini Proxy Error:", error);
    return "Desculpe, tive um erro ao processar sua análise botânica.";
  }
}

export async function analyzeScientificPaper(query: string, paperText: string) {
  try {
    const response = await fetch("/api/analyze-paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, paperText }),
    });

    if (!response.ok) throw new Error("Erro na comunicação com o servidor");
    const data = await response.json();
    return data.response || "Erro ao analisar o artigo científico.";
  } catch (error) {
    console.error("Gemini RAG Proxy Error:", error);
    return "Erro ao analisar o artigo científico.";
  }
}
