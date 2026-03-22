/*
 * ════════════════════════════════════════════════════════════════
 * AutoInspect AI — Código de Produção
 * ════════════════════════════════════════════════════════════════
 * 
 * INSTRUÇÕES DE INTEGRAÇÃO:
 * 
 * 1. Substitua "SUA_API_KEY_AQUI" pela sua chave API da Anthropic
 * 2. Em produção, NUNCA exponha a API key no frontend.
 *    Use um endpoint backend (ex: /api/analyze) que faz a chamada à API.
 * 3. A compressão de imagem é optimizada para 1568px (máximo recomendado
 *    pela API Claude Vision) a 85% de qualidade JPEG.
 * 4. Custo estimado: ~$0.01-0.04 por foto, ~$0.20-0.46 por veículo.
 * 
 * ARQUITECTURA RECOMENDADA:
 * 
 *   [Telemóvel] → foto → [Frontend React] → base64 comprimido
 *        → [Seu Backend /api/analyze] → [API Anthropic Claude Vision]
 *        → JSON danos → [Frontend] → preview + relatório
 * 
 * ════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURAÇÃO ───
const API_KEY = "SUA_API_KEY_AQUI"; // ⚠️ Mover para backend em produção!
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1500;
const IMAGE_MAX_PX = 1568; // Máximo recomendado pela API Claude Vision
const IMAGE_QUALITY = 0.85; // 85% JPEG — equilíbrio qualidade/custo

// ─── PROMPT DE ANÁLISE (produção) ───
const ANALYSIS_PROMPT = (posLabel) => `Você é um perito em inspeção de danos em veículos automóveis. Analise esta fotografia tirada da posição "${posLabel}" do veículo.

VALIDAÇÃO INICIAL:
- Se a imagem NÃO mostrar um veículo automóvel, responda APENAS: {"qualidade":"rejeitada","motivo":"A imagem não contém um veículo automóvel","instrucao":"Tire uma foto de um veículo para continuar"}
- Se a foto não tem qualidade suficiente (foco, iluminação, distância), responda APENAS: {"qualidade":"rejeitada","motivo":"descrição do problema","instrucao":"como melhorar"}

TAREFAS (apenas se a imagem mostrar um veículo com qualidade adequada):
1. MATRÍCULA: Se visível, leia-a.
2. DANOS visíveis nas peças: Para-brisas, Capot, Para-choque dianteiro, Farol esquerdo, Farol direito, Guarda-lamas dianteiro esquerdo, Jante dianteira esquerda, Retrovisor esquerdo, Porta frente esquerda, Embaladeira esquerda, Porta traseira esquerda, Guarda-lamas traseiro esquerdo, Jante traseira esquerda, Guarda-lamas dianteiro direito, Jante dianteira direita, Retrovisor direito, Porta frente direita, Embaladeira direita, Porta traseira direita, Guarda-lamas traseiro direito, Vidro traseiro, Tampa da mala, Para-choque traseiro, Farolim esquerdo, Farolim direito, Teto.
   Sub-componentes possíveis: vidro, friso, grelha, pisca.
3. GRAVIDADES possíveis: risco_superficial, risco, mossa, amassado, batida_grave, partido
4. CONDIÇÕES adversas: sujeira, água, reflexos, iluminação fraca.

Responda APENAS em JSON válido, sem markdown, sem backticks:
{"qualidade":"aceite","condicoes_adversas":[],"matricula":{"valor":"AA-00-BB","confianca":95},"danos":[{"peca":"nome","sub_componente":null,"gravidade":"amassado","confianca":85,"descricao":"Descrição curta","posicao_x":50,"posicao_y":50}],"zonas_duvida":["zona"]}

REGRAS:
- Conservador: prefira não reportar dano a reportar falso positivo
- Confiança abaixo de 40% = não reportar
- Distinga sujeira/água/reflexo de danos reais
- Se zona tem reflexo, reduza confiança em 20%
- Reporte zonas que precisam de close-up em zonas_duvida`;


// ─── COMPRESSÃO DE IMAGEM (produção — 1568px, 85% qualidade) ───
function compressImage(dataUrl, maxPx = IMAGE_MAX_PX, quality = IMAGE_QUALITY) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        
        // Redimensionar mantendo proporção, máximo 1568px no lado maior
        if (w > h) {
          if (w > maxPx) { h = Math.round(h * (maxPx / w)); w = maxPx; }
        } else {
          if (h > maxPx) { w = Math.round(w * (maxPx / h)); h = maxPx; }
        }
        
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        
        const compressed = canvas.toDataURL("image/jpeg", quality);
        const base64 = compressed.split(",")[1];
        
        console.log(`[AutoInspect] Imagem comprimida: ${w}x${h}px, ${(base64.length / 1024).toFixed(0)}KB`);
        resolve(base64);
      } catch (err) {
        reject(new Error(`Erro ao comprimir imagem: ${err.message}`));
      }
    };
    img.onerror = () => reject(new Error("Erro ao carregar imagem"));
    img.src = dataUrl;
  });
}


// ─── CHAMADA À API (produção) ───
async function analyzePhoto(base64Data, position) {
  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: base64Data
          }
        },
        {
          type: "text",
          text: ANALYSIS_PROMPT(position.label)
        }
      ]
    }]
  };

  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,           // ← Chave API
        "anthropic-version": "2023-06-01" // ← Versão da API
      },
      body: JSON.stringify(requestBody)
    });
  } catch (networkError) {
    return {
      qualidade: "erro",
      motivo: `Erro de rede: ${networkError.message}`,
      danos: []
    };
  }

  // Ler resposta como texto primeiro
  let rawText;
  try {
    rawText = await response.text();
  } catch (readError) {
    return {
      qualidade: "erro",
      motivo: `Erro ao ler resposta: ${readError.message}`,
      danos: []
    };
  }

  // Verificar status HTTP
  if (!response.ok) {
    return {
      qualidade: "erro",
      motivo: `HTTP ${response.status}: ${rawText.substring(0, 200)}`,
      danos: []
    };
  }

  // Parse do JSON da resposta da API
  let apiResponse;
  try {
    apiResponse = JSON.parse(rawText);
  } catch (parseError) {
    return {
      qualidade: "erro",
      motivo: `JSON inválido na resposta: ${rawText.substring(0, 200)}`,
      danos: []
    };
  }

  // Verificar erros da API
  if (apiResponse.error) {
    return {
      qualidade: "erro",
      motivo: `API: ${apiResponse.error.message || JSON.stringify(apiResponse.error)}`,
      danos: []
    };
  }

  // Extrair texto da resposta
  const textContent = (apiResponse.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("");

  if (!textContent.trim()) {
    return {
      qualidade: "erro",
      motivo: "Resposta vazia da API",
      danos: []
    };
  }

  // Parse do JSON de análise de danos
  try {
    const cleanText = textContent.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanText);
  } catch (analysisParseError) {
    return {
      qualidade: "erro",
      motivo: `Erro ao processar análise: ${textContent.substring(0, 200)}`,
      danos: []
    };
  }
}


// ─── HANDLER DE UPLOAD (produção) ───
async function handlePhotoUpload(file, position) {
  // 1. Ler ficheiro como data URL
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Erro ao ler ficheiro"));
    reader.readAsDataURL(file);
  });

  // 2. Comprimir imagem para 1568px, 85% qualidade
  const base64 = await compressImage(dataUrl, IMAGE_MAX_PX, IMAGE_QUALITY);

  // 3. Analisar com Claude Vision
  const result = await analyzePhoto(base64, position);

  return {
    preview: dataUrl,    // Para mostrar na UI (original)
    base64: base64,      // Comprimida (para referência)
    analysis: result     // Resultado da análise
  };
}


// ─── SEQUÊNCIA DE FOTOS (produção — 1 volta) ───
const PHOTO_SEQUENCE = [
  { id:1,  label:"Frente",             angle:"0°",   type:"ext",   instruction:"Frente do carro, a ~2m, centrado." },
  { id:2,  label:"Frente-Direita",     angle:"45°",  type:"ext",   instruction:"Diagonal frontal direita, a ~2m." },
  { id:3,  label:"Jante Diant. Dir.",   angle:"-",    type:"jante", instruction:"Close-up jante dianteira direita, ~50cm." },
  { id:4,  label:"Direita",            angle:"90°",  type:"ext",   instruction:"Centro da lateral direita, a ~2m." },
  { id:5,  label:"Jante Tras. Dir.",    angle:"-",    type:"jante", instruction:"Close-up jante traseira direita, ~50cm." },
  { id:6,  label:"Traseira-Direita",   angle:"135°", type:"ext",   instruction:"Diagonal traseira direita, a ~2m." },
  { id:7,  label:"Traseira",           angle:"180°", type:"ext",   instruction:"Traseira do carro, a ~2m, centrado." },
  { id:8,  label:"Traseira-Esquerda",  angle:"135°", type:"ext",   instruction:"Diagonal traseira esquerda, a ~2m." },
  { id:9,  label:"Jante Tras. Esq.",    angle:"-",    type:"jante", instruction:"Close-up jante traseira esquerda, ~50cm." },
  { id:10, label:"Esquerda",           angle:"90°",  type:"ext",   instruction:"Centro da lateral esquerda, a ~2m." },
  { id:11, label:"Jante Diant. Esq.",   angle:"-",    type:"jante", instruction:"Close-up jante dianteira esquerda, ~50cm." },
  { id:12, label:"Frente-Esquerda",    angle:"45°",  type:"ext",   instruction:"Diagonal frontal esquerda, a ~2m." },
  { id:13, label:"Teto",               angle:"-",    type:"teto",  instruction:"Braço esticado, telemóvel para baixo, centro." },
];


// ─── SCHEMA JSON DE SAÍDA ───
/*
{
  "veiculo": {
    "matricula": "AA-12-BB",
    "matricula_confianca": 97,
    "data_analise": "2026-03-22T14:30:00Z",
    "total_fotos": 14,
    "total_danos": 3,
    "confianca_geral": 78,
    "condicoes": ["reflexo_parcial_lateral_direita"]
  },
  "danos": [
    {
      "id": 1,
      "peca": "Para-choque dianteiro",
      "sub_componente": null,
      "regiao": "frente",
      "gravidade": "amassado",
      "confianca": 88,
      "descricao": "Amassado visível na parte central inferior",
      "foto_origem": "Frente"
    }
  ],
  "danos_rejeitados": [
    {
      "peca": "Capot",
      "gravidade_original": "risco_superficial",
      "confianca_original": 35,
      "motivo": "falso_positivo"
    }
  ],
  "alertas": ["Reflexo parcial na lateral direita"],
  "recomendacoes": ["Verificação presencial recomendada para danos com confiança < 70%"]
}
*/

// ─── ESCALA DE GRAVIDADE ───
const SEVERITY_SCALE = {
  risco_superficial: { level: 1, label: "Risco Superficial", color: "#3B82F6" },
  risco:             { level: 2, label: "Risco",             color: "#2563EB" },
  mossa:             { level: 3, label: "Mossa",             color: "#EA580C" },
  amassado:          { level: 4, label: "Amassado",          color: "#DC2626" },
  batida_grave:      { level: 5, label: "Batida Grave",      color: "#B91C1C" },
  partido:           { level: 6, label: "Partido",           color: "#991B1B" },
};

// ─── EXPORTAR FUNÇÕES PARA USO NO SEU BACKEND ───
export {
  compressImage,
  analyzePhoto,
  handlePhotoUpload,
  ANALYSIS_PROMPT,
  PHOTO_SEQUENCE,
  SEVERITY_SCALE,
};
