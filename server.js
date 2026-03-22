const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// Segurança
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Demasiados pedidos. Aguarde.' }
}));

// Servir o frontend (ficheiros estáticos)
app.use(express.static(path.join(__dirname, 'public')));

// Prompt de análise
function buildPrompt(positionLabel) {
  return `Você é um perito em inspeção de danos em veículos automóveis.
Analise esta fotografia tirada da posição "${positionLabel}" do veículo.

VALIDAÇÃO INICIAL:
- Se a imagem NÃO mostrar um veículo automóvel, responda APENAS:
  {"qualidade":"rejeitada","motivo":"A imagem não contém um veículo","instrucao":"Tire uma foto de um veículo"}
- Se a foto não tem qualidade suficiente, responda APENAS:
  {"qualidade":"rejeitada","motivo":"descrição","instrucao":"como melhorar"}

TAREFAS:
1. MATRÍCULA: Se visível, leia-a.
2. DANOS visíveis nas peças: Para-brisas, Capot, Para-choque dianteiro,
   Farol esquerdo, Farol direito, Guarda-lamas dianteiro esquerdo,
   Jante dianteira esquerda, Retrovisor esquerdo, Porta frente esquerda,
   Embaladeira esquerda, Porta traseira esquerda, Guarda-lamas traseiro esquerdo,
   Jante traseira esquerda, Guarda-lamas dianteiro direito, Jante dianteira direita,
   Retrovisor direito, Porta frente direita, Embaladeira direita,
   Porta traseira direita, Guarda-lamas traseiro direito, Vidro traseiro,
   Tampa da mala, Para-choque traseiro, Farolim esquerdo, Farolim direito, Teto.
   Sub-componentes: vidro, friso, grelha, pisca.
3. GRAVIDADES: risco_superficial, risco, mossa, amassado, batida_grave, partido
4. CONDIÇÕES adversas: sujeira, água, reflexos, iluminação fraca.

Responda APENAS em JSON válido, sem markdown:
{"qualidade":"aceite","condicoes_adversas":[],"matricula":{"valor":"AA-00-BB","confianca":95},
"danos":[{"peca":"nome","sub_componente":null,"gravidade":"amassado","confianca":85,
"descricao":"Descrição curta","posicao_x":50,"posicao_y":50}],"zonas_duvida":["zona"]}

REGRAS:
- Conservador: prefira não reportar dano a falso positivo
- Confiança <40% = não reportar
- Distinga sujeira/água/reflexo de danos
- Reflexo reduz confiança 20%`;
}

// Endpoint de análise
app.post('/api/analyze', async (req, res) => {
  try {
    const { image_base64, position_label } = req.body;

    if (!image_base64 || !position_label) {
      return res.status(400).json({
        qualidade: 'erro',
        motivo: 'Dados em falta',
        danos: []
      });
    }

    // Verificar tamanho
    if (image_base64.length > 3 * 1024 * 1024) {
      return res.status(400).json({
        qualidade: 'erro',
        motivo: 'Imagem demasiado grande',
        danos: []
      });
    }

    // Chamar API Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image_base64
              }
            },
            {
              type: 'text',
              text: buildPrompt(position_label)
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      return res.status(500).json({
        qualidade: 'erro',
        motivo: `Erro da API (${response.status})`,
        danos: []
      });
    }

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({
        qualidade: 'erro',
        motivo: data.error.message,
        danos: []
      });
    }

    const textContent = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const cleanText = textContent.replace(/```json|```/g, '').trim();
    const result = JSON.parse(cleanText);

    res.json(result);

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      qualidade: 'erro',
      motivo: 'Erro interno do servidor',
      danos: []
    });
  }
});

// Qualquer outra rota serve o frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AutoInspect AI a correr na porta ${PORT}`);
});
