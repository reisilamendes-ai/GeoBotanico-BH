import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini API Initialization
  const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY || '');
  
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

  // API Routes
  app.post("/api/ask", async (req, res) => {
    try {
      const { query, contextData } = req.body;
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: SYSTEM_INSTRUCTION
      });

      const result = await model.generateContent(`Aqui estão os dados atuais do banco: ${JSON.stringify(contextData)}.
Pergunta do pesquisador: '${query}'`);
      
      res.json({ response: result.response.text() });
    } catch (error) {
      console.error("Gemini Error:", error);
      res.status(500).json({ error: "Erro ao processar a análise botânica." });
    }
  });

  app.post("/api/analyze-paper", async (req, res) => {
    try {
      const { query, paperText } = req.body;
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: "Aja como um assistente RAG especializado em botânica mineira."
      });

      const result = await model.generateContent(`Com base no seguinte texto científico:
---
${paperText}
---
Assunto: ${query}

Responda de forma técnica e objetiva.`);
      
      res.json({ response: result.response.text() });
    } catch (error) {
      console.error("Gemini RAG Error:", error);
      res.status(500).json({ error: "Erro ao analisar o artigo científico." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
