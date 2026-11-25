import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  AnalysisErrorPayload,
  AppArchitecture,
  CollectedResearchData,
  CompanyProfile,
  ScannerBlueprintResult,
  VerifiedSource,
} from './src/types/blueprint.ts';
import {
  isPrivateOrBlockedHost,
  normalizeHttpUrl,
  runUniversalCompanyResearch,
} from './server/universalResearch.ts';

const PORT = 3000;
const MODEL_ID = 'gemini-4-hydrogen';
const CACHE_TTL_MS = 30 * 60 * 1000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const blueprintCache = new Map<string, { result: ScannerBlueprintResult; expiresAt: number }>();
const inFlightAnalyses = new Map<string, Promise<ScannerBlueprintResult>>();

function normalizeCacheKey(resolvedUrl: string, rawInput: string): string {
  try {
    const u = new URL(resolvedUrl || rawInput);
    return `${u.hostname.toLowerCase()}${u.pathname}${u.search}`.replace(/\/+$/, '');
  } catch {
    return rawInput.trim();
  }
}

function extractJsonObject(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('A resposta consolidada não retornou um JSON válido.');
  }
}

function buildBlueprintFromCollectedData(
  collected: CollectedResearchData,
  extraLimitation?: string
): ScannerBlueprintResult {
  const businessName =
    collected.placeName ||
    collected.legalName ||
    collected.metaTitle ||
    collected.queryHint ||
    'Empresa Identificada';

  const statusTag = (key: string): string => {
    const st = collected.fieldStatuses?.[key];
    if (st === 'confirmed') return 'Confirmada';
    if (st === 'unconfirmed') return 'Encontrada (não confirmada)';
    return 'Não encontrada';
  };

  const locationSummary = collected.cityState
    ? collected.cityState
    : collected.latLng
      ? `Coordenadas: ${collected.latLng.latitude.toFixed(6)}, ${collected.latLng.longitude.toFixed(6)}`
      : collected.sourceOrigin
        ? `Origem: ${collected.sourceOrigin}`
        : 'Localização não detalhada';

  const limitations: string[] = [...(collected.limitations || [])];
  if (extraLimitation && !limitations.includes(extraLimitation)) {
    limitations.unshift(extraLimitation);
  }
  if (!collected.phone && !collected.whatsapp) {
    limitations.push('Telefone/WhatsApp não localizado nas fontes públicas consultadas.');
  }
  if (!collected.hours) {
    limitations.push('Horários de funcionamento não localizados nas fontes públicas consultadas.');
  }
  if (!collected.website) {
    limitations.push('Site institucional oficial não localizado ou ausente.');
  }

  const verifiedGoogleMapsUrl = collected.googleMapsUrl || collected.resolvedMapsUrl;

  const companyProfile: CompanyProfile = {
    name: businessName,
    legalName: collected.legalName || null,
    cnpj: collected.cnpj || null,
    sourceOrigin: collected.sourceOrigin,
    category:
      collected.segment ||
      (collected.metaDescription
        ? `Segmento inferido dos metadados: ${collected.metaDescription}`
        : 'Segmento não especificado nas fontes públicas consultadas'),
    address:
      collected.address ||
      'Não localizado nas fontes públicas consultadas (confirmar endereço antes da publicação)',
    phone:
      collected.phone ||
      (collected.whatsapp ? `WhatsApp ${collected.whatsapp}` : 'Não localizado nas fontes públicas consultadas'),
    whatsapp: collected.whatsapp || null,
    hours: collected.hours || 'Não localizado nas fontes públicas consultadas',
    locationSummary,
    productsAndServices:
      collected.productsAndServices && collected.productsAndServices.length > 0
        ? collected.productsAndServices
        : [
            collected.segment
              ? `Atividades principais em ${collected.segment}`
              : 'Portfólio comercial a confirmar diretamente com o estabelecimento',
            'Atendimento comercial e dúvidas via canal direto (WhatsApp)',
            'Consulta de endereço, canais digitais e localização oficial',
          ],
    reviewsAndDifferentiators: collected.metaDescription
      ? `Resumo público obtido na fonte analisada: "${collected.metaDescription}".`
      : 'Avaliações detalhadas não acessadas automaticamente; recomenda-se incluir depoimentos reais autorizados pela empresa.',
    socialLinks: {
      googleMapsUrl: verifiedGoogleMapsUrl,
      website: normalizeHttpUrl(collected.website),
      instagram: normalizeHttpUrl(collected.instagram),
      facebook: normalizeHttpUrl(collected.facebook),
      linkedin: normalizeHttpUrl(collected.linkedin),
    },
    visualReferences:
      collected.visualReferences ||
      'Fotografias do estabelecimento não acessadas automaticamente nesta etapa. Utilizar fotos reais autorizadas pela empresa.',
    identityAndPositioning: `Identidade arquitetada para "${businessName}" (${
      collected.sourceOrigin || 'Fonte pública'
    })${collected.cnpj ? ` · CNPJ ${collected.cnpj}` : ''}, priorizando confiança comercial, presença digital unificada e conversão direta no mobile.`,
    verifiedSources: collected.verifiedSources,
    limitations: Array.from(new Set(limitations)),
    fieldStatuses: collected.fieldStatuses,
  };

  const whatsappTargetHint = collected.whatsapp
    ? `wa.me/${collected.whatsapp}`
    : collected.phone
      ? `canal telefônico (${collected.phone})`
      : 'link wa.me (inserir número oficial confirmado em businessConfig.ts)';

  const architecture: AppArchitecture = {
    conceptAndObjective: `Aplicativo web comercial e catálogo interativo mobile-first para "${businessName}", integrando os dados públicos reais identificados (${collected.sourceOrigin || 'fonte pública'}) com navegação 3D fluida, links oficiais verificados e conversão imediata via WhatsApp.`,
    targetAudience: {
      primaryPersona: `Clientes que descobrem "${businessName}" via ${
        collected.sourceOrigin || 'busca local'
      } ou redes sociais e desejam validar serviços, contatos e falar pelo celular em segundos.`,
      secondaryPersona: 'Clientes recorrentes que salvam o aplicativo como atalho rápido para contato e novidades.',
      painPoints: [
        'Informações comerciais espalhadas entre redes sociais, site e mapas',
        'Falta de um canal direto e contextualizado para iniciar atendimento no WhatsApp',
        'Dificuldade de confirmar rapidamente endereço, horários e serviços no celular',
      ],
      mobileHabits: 'Acesso predominante via smartphone com navegação de uma mão e preferência por ações imediatas.',
    },
    visualIdentity: {
      styleDirection: 'Estética tecnológica comercial de alto contraste com superfícies em camadas 3D, bordas especulares sutis e acentos luminosos orientados à ação.',
      atmosphere: 'Profissional, contemporânea, confiável e fluida, valorizando fotos reais da marca.',
      brandVoice: 'Direto, acolhedor, transparente e focado em resolver a necessidade do cliente.',
      motif3D: 'Cartões com elevação espacial em perspectiva suave, iluminação direcional de estúdio e botões táteis arredondados com brilho calibrado.',
    },
    colorPalette: [
      {
        name: 'Obsidiana Espacial',
        hex: '#080D1A',
        role: 'Fundo Dominante (60%)',
        usage: 'Canvas principal do aplicativo, garantindo conforto visual e contraste WCAG AA.',
      },
      {
        name: 'Ardósia Estrutural',
        hex: '#111A2E',
        role: 'Superfícies 3D (30%)',
        usage: 'Painéis, cartões de serviços e navegação com bordas sutis.',
      },
      {
        name: 'Ciano Neon Calibrado',
        hex: '#22D3EE',
        role: 'Acento Primário (10%)',
        usage: 'Botões principais de conversão, indicadores ativos e estados de foco.',
      },
      {
        name: 'Índigo Profundo',
        hex: '#6366F1',
        role: 'Acento Secundário',
        usage: 'Luz de recorte em elementos 3D e transições interativas.',
      },
      {
        name: 'Branco Mineral',
        hex: '#F8FAFC',
        role: 'Tipografia Principal',
        usage: 'Títulos e textos de alta legibilidade sobre fundo escuro.',
      },
    ],
    typography: {
      displayFont: 'Outfit',
      bodyFont: 'Plus Jakarta Sans',
      monoFont: 'JetBrains Mono',
      rationale: 'Outfit entrega presença geométrica nos títulos; Plus Jakarta Sans assegura leitura rápida no mobile; JetBrains Mono alinha CNPJ, horários e telefones com precisão tabular.',
    },
    style3DAndEffects: {
      depthSystem: 'Hierarquia de elevação única com gradientes internos sutis, borda superior iluminada e separação clara por espaço em branco.',
      lightingAndShadows: 'Sombras realistas multicamadas (0 20px 40px -16px rgba(0,0,0,0.7)) simulando iluminação superior suave.',
      neonAndAccentTreatment: 'Brilho ciano concentrado exclusivamente nos CTAs principais e estados de foco.',
      microInteractions: 'Respostas táteis em <= 180ms usando apenas transform e opacity com curva cubic-bezier(0.16, 1, 0.3, 1).',
      buttonStyle: 'Botões em cápsula arredondada (rounded-full) com relevo 3D sutil e alvo de toque >= 44px no mobile.',
    },
    screens: [
      {
        id: 'home',
        name: 'Início & Apresentação',
        route: '/',
        purpose: `Apresentar "${businessName}" com impacto visual imediato e direcionar para WhatsApp e canais verificados.`,
        layoutStructure: 'Hero em destaque com título, resumo institucional confirmado, dois CTAs arredondados e faixa de diferenciais.',
        keyComponents: ['Cabeçalho limpo de 3 zonas', 'Bloco Hero com profundidade 3D', 'Cartões de destaque de atendimento', 'Bloco de transparência cadastral'],
        primaryButtons: ['Falar no WhatsApp', collected.googleMapsUrl ? 'Traçar Rota no Maps' : 'Ver Canais Oficiais'],
        userInteractions: ['Toque direto para contato ou rota', 'Pré-visualização interativa dos serviços'],
      },
      {
        id: 'catalogo',
        name: 'Produtos & Serviços',
        route: '/servicos',
        purpose: 'Organizar o portfólio comercial da empresa com busca rápida e pedido contextualizado.',
        layoutStructure: 'Filtro segmentado no topo seguido de grade responsiva de cartões 3D.',
        keyComponents: ['Barra de busca instantânea', 'Filtros por categoria', 'Cartões 3D com botão de orçamento'],
        primaryButtons: ['Solicitar no WhatsApp', 'Ver Detalhes'],
        userInteractions: ['Filtragem em tempo real', 'Preenchimento automático do assunto no WhatsApp'],
      },
      {
        id: 'localizacao',
        name: 'Localização & Dados Oficiais',
        route: '/localizacao',
        purpose: 'Exibir endereço, CNPJ/razão social (quando verificados), horários e botão de rota.',
        layoutStructure: 'Painel dividido com dados cadastrais verificados e acesso direto a mapa/endereço.',
        keyComponents: ['Quadro de horários e endereço', 'Bloco cadastral verificado', 'Botões para canais oficiais'],
        primaryButtons: [collected.googleMapsUrl ? 'Abrir no Google Maps' : 'Copiar Endereço', 'Copiar Telefone'],
        userInteractions: ['Cópia de dados com feedback visual', 'Abertura de rota em 1 toque'],
      },
      {
        id: 'contato',
        name: 'Atendimento & Redes',
        route: '/contato',
        purpose: 'Centralizar o contato rápido via WhatsApp e os canais sociais reais encontrados.',
        layoutStructure: 'Pré-atendimento leve montando mensagem estruturada para envio direto via WhatsApp.',
        keyComponents: ['Seletor de assunto', 'Campo de nome e dúvida', 'Links verificados (Site, Instagram, Facebook)'],
        primaryButtons: ['Enviar Mensagem no WhatsApp', 'Compartilhar Aplicativo'],
        userInteractions: ['Geração de link wa.me contextualizado', 'Compartilhamento nativo via Web Share API'],
      },
    ],
    buttonsAndFeatures: [
      {
        label: 'Falar no WhatsApp',
        action: `Direciona para ${whatsappTargetHint} com mensagem contextualizada`,
        screenLocation: 'Início e Serviços',
        businessValue: 'Acelera a conversão de visitantes mobile em atendimentos reais.',
      },
      {
        label: collected.googleMapsUrl ? 'Abrir no Google Maps' : 'Abrir Canal Principal',
        action: `Direciona para o link verificado (${verifiedGoogleMapsUrl})`,
        screenLocation: 'Início e Localização',
        businessValue: 'Facilita validação e deslocamento presencial com 1 toque.',
      },
      {
        label: 'Solicitar Orçamento / Item',
        action: 'Preenche automaticamente o produto ou serviço na mensagem de contato',
        screenLocation: 'Produtos & Serviços',
        businessValue: 'Qualifica o atendimento desde a primeira mensagem.',
      },
      {
        label: 'Compartilhar Empresa',
        action: 'Aciona navigator.share ou copia o link do app',
        screenLocation: 'Contato e Rodapé',
        businessValue: 'Estimula indicação orgânica.',
      },
    ],
    navigationAndUX: {
      navigationPattern: 'Barra superior enxuta em desktop e barra inferior fixa acessível ao polegar no mobile (altura <= 12% da viewport).',
      userFlowSteps: [
        'Visitante abre o app a partir da bio, busca ou indicação',
        'Identifica imediatamente nome, segmento e dados verificados da empresa',
        'Explora serviços/produtos disponíveis e escolhe o item de interesse',
        'Finaliza com 1 toque para conversar no WhatsApp ou consultar localização',
      ],
      accessibilityNotes: 'Contraste mínimo 4.5:1, foco visível por teclado, alvos de toque >= 44px no mobile e suporte a prefers-reduced-motion.',
    },
    recommendedIntegrations: [
      {
        name: 'WhatsApp Click-to-Chat (wa.me)',
        category: 'Conversão e Atendimento',
        purpose: 'Iniciar conversas com mensagem pré-preenchida sem API Business paga.',
        costTier: 'Gratuito (padrão)',
      },
      {
        name: 'Links Diretos Verificados (Maps / Redes / Site)',
        category: 'Navegação e Presença Digital',
        purpose: 'Conectar o usuário diretamente aos canais oficiais confirmados sem API paga.',
        costTier: 'Gratuito',
      },
      {
        name: 'Web Share API + Clipboard',
        category: 'Crescimento Orgânico',
        purpose: 'Compartilhar o aplicativo e copiar endereço/telefone/CNPJ nativamente.',
        costTier: 'Gratuito (nativo do navegador)',
      },
    ],
    whatsappAndSocialStrategy: {
      whatsappFlow: `Os botões de ação montam uma mensagem estruturada com origem e interesse, conectando ao ${whatsappTargetHint}.`,
      prefilledMessageTemplate: `Olá! Vim pelo aplicativo de ${businessName} e gostaria de atendimento sobre: [Serviço/Produto].`,
      instagramFunnel: collected.instagram
        ? `Integrar o app diretamente ao Instagram oficial verificado (${collected.instagram}) e link na bio.`
        : 'Inserir o link do aplicativo na bio do Instagram oficial assim que o perfil for confirmado pela empresa.',
      facebookAndLocalSeo: collected.facebook || collected.website
        ? `Alinhar links cruzados entre o app${collected.website ? `, site (${collected.website})` : ''}${collected.facebook ? ` e Facebook (${collected.facebook})` : ''}.`
        : 'Consolidar o aplicativo na ficha do Google Meu Negócio e páginas sociais confirmadas pelo proprietário.',
      retentionTactics: [
        'Atalho "Adicionar à Tela Inicial" para acesso recorrente em 1 toque',
        'Seção atualizável de destaques comerciais em arquivo de configuração',
        'Convite discreto pós-atendimento para avaliação no Google Maps',
      ],
    },
  };

  const executiveReportMarkdown = [
    `# Relatório Arquitetônico — ${businessName}`,
    '',
    '## 1. Identificação Universal da Empresa (Fontes Cruzadas)',
    `- **Origem inicial pesquisada:** ${collected.sourceOrigin || 'Link público'} (${collected.originalInputUrl})`,
    `- **Nome comercial:** ${companyProfile.name} — *Status: ${statusTag('name')}*`,
    `- **Razão social:** ${companyProfile.legalName || 'Não localizada'} — *Status: ${statusTag('legalName')}*`,
    `- **CNPJ:** ${companyProfile.cnpj || 'Não localizado'} — *Status: ${statusTag('cnpj')}*`,
    `- **Segmento:** ${companyProfile.category}`,
    `- **Endereço:** ${companyProfile.address} — *Status: ${statusTag('address')}*`,
    `- **Telefone:** ${companyProfile.phone} — *Status: ${statusTag('phone')}*`,
    `- **WhatsApp:** ${companyProfile.whatsapp || 'Não localizado'} — *Status: ${statusTag('whatsapp')}*`,
    `- **Horários:** ${companyProfile.hours} — *Status: ${statusTag('hours')}*`,
    `- **Site oficial:** ${companyProfile.socialLinks.website || 'Não localizado'} — *Status: ${statusTag('website')}*`,
    `- **Instagram:** ${companyProfile.socialLinks.instagram || 'Não localizado'} — *Status: ${statusTag('instagram')}*`,
    `- **Facebook:** ${companyProfile.socialLinks.facebook || 'Não localizado'} — *Status: ${statusTag('facebook')}*`,
    `- **Google Maps:** ${collected.googleMapsUrl || 'Não localizado'} — *Status: ${statusTag('googleMapsUrl')}*`,
    '',
    '### Limitações e Transparência',
    ...companyProfile.limitations.map((l) => `- ${l}`),
    '',
    '## 2. Arquitetura do Aplicativo (11 Pilares)',
    `### 01. Conceito e Objetivo\n${architecture.conceptAndObjective}`,
    `### 02. Público-Alvo\n- **Primário:** ${architecture.targetAudience.primaryPersona}\n- **Secundário:** ${architecture.targetAudience.secondaryPersona}\n- **Hábitos Mobile:** ${architecture.targetAudience.mobileHabits}`,
    `### 03. Identidade Visual\n${architecture.visualIdentity.styleDirection} Atmosfera: ${architecture.visualIdentity.atmosphere}`,
    `### 04. Paleta de Cores\n${architecture.colorPalette.map((c) => `- **${c.name} (${c.hex})** — ${c.role}: ${c.usage}`).join('\n')}`,
    `### 05. Tipografia\n- Display: ${architecture.typography.displayFont}\n- Corpo: ${architecture.typography.bodyFont}\n- Dados: ${architecture.typography.monoFont}`,
    `### 06. Estilo 3D e Efeitos Visuais\n${architecture.style3DAndEffects.depthSystem} ${architecture.style3DAndEffects.lightingAndShadows}`,
    `### 07. Telas Projetadas\n${architecture.screens.map((s, i) => `${i + 1}. **${s.name}** (\`${s.route}\`): ${s.purpose}`).join('\n')}`,
    `### 08. Botões e Funcionalidades\n${architecture.buttonsAndFeatures.map((b) => `- **${b.label}** (${b.screenLocation}): ${b.action}`).join('\n')}`,
    `### 09. Navegação e UX\n${architecture.navigationAndUX.navigationPattern}`,
    `### 10. Integrações Recomendadas\n${architecture.recommendedIntegrations.map((r) => `- **${r.name}** (${r.costTier}): ${r.purpose}`).join('\n')}`,
    `### 11. Estratégia WhatsApp e Redes Sociais\n${architecture.whatsappAndSocialStrategy.whatsappFlow}\n- Mensagem modelo: \`${architecture.whatsappAndSocialStrategy.prefilledMessageTemplate}\``,
  ].join('\n\n');

  const finalBuildPrompt = [
    `Atue como engenheiro front-end sênior e designer UI/UX especialista em experiências 3D modernas. Construa o aplicativo web comercial oficial para a empresa "${businessName}".`,
    '',
    '1. DADOS IDENTIFICADOS E VERIFICADOS DA EMPRESA (NUNCA INVENTE DADOS NÃO LOCALIZADOS):',
    `- Nome comercial: ${businessName} (${statusTag('name')})`,
    companyProfile.legalName ? `- Razão social: ${companyProfile.legalName} (${statusTag('legalName')})` : '- Razão social: Não localizada',
    companyProfile.cnpj ? `- CNPJ: ${companyProfile.cnpj} (${statusTag('cnpj')})` : '- CNPJ: Não localizado',
    `- Segmento: ${companyProfile.category}`,
    `- Endereço: ${companyProfile.address} (${statusTag('address')})`,
    `- Telefone: ${companyProfile.phone} (${statusTag('phone')})`,
    companyProfile.whatsapp ? `- WhatsApp: ${companyProfile.whatsapp} (${statusTag('whatsapp')})` : '- WhatsApp: Não localizado (solicitar confirmação antes de publicar)',
    `- Site oficial: ${companyProfile.socialLinks.website || 'Não localizado'}`,
    `- Instagram: ${companyProfile.socialLinks.instagram || 'Não localizado'}`,
    `- Facebook: ${companyProfile.socialLinks.facebook || 'Não localizado'}`,
    `- Google Maps: ${collected.googleMapsUrl || 'Não localizado'}`,
    '- REGRA CRÍTICA: Para quaisquer campos marcados como "Não localizado", crie um arquivo `src/data/businessConfig.ts` com marcadores claros de preenchimento pelo proprietário e nunca invente telefones, endereços, horários ou URLs.',
    '',
    '2. DIREÇÃO DE ARTE, IDENTIDADE VISUAL E ESTÉTICA 3D:',
    `- Estética: ${architecture.visualIdentity.styleDirection}`,
    `- Paleta de cores (60-30-10): ${architecture.colorPalette.map((c) => `${c.name} (${c.hex} - ${c.role})`).join('; ')}.`,
    `- Tipografia: Títulos em "${architecture.typography.displayFont}", corpo em "${architecture.typography.bodyFont}", dados em "${architecture.typography.monoFont}" (tabular-nums).`,
    `- Profundidade 3D e efeitos: ${architecture.style3DAndEffects.depthSystem} ${architecture.style3DAndEffects.lightingAndShadows} ${architecture.style3DAndEffects.neonAndAccentTreatment}`,
    `- Botões: ${architecture.style3DAndEffects.buttonStyle} com microinterações em <= 180ms.`,
    '',
    '3. ARQUITETURA DAS TELAS E INTERAÇÕES:',
    ...architecture.screens.map(
      (s, i) =>
        `Tela ${i + 1} — ${s.name} (${s.route}): ${s.purpose} Layout: ${s.layoutStructure} Componentes: ${s.keyComponents.join(', ')}. Botões principais: ${s.primaryButtons.join(', ')}. Interações: ${s.userInteractions.join(', ')}.`
    ),
    '',
    '4. ESTRATÉGIA DE CONVERSÃO (WHATSAPP + CANAIS GRATUITOS):',
    `- Fluxo WhatsApp conectado a ${whatsappTargetHint} com mensagem pré-preenchida: "${architecture.whatsappAndSocialStrategy.prefilledMessageTemplate}".`,
    '- Botões de redes sociais e rota apontando exclusivamente para os links reais listados na seção 1.',
    '- Compartilhamento nativo via Web Share API com fallback de cópia.',
    '',
    '5. REQUISITOS TÉCNICOS:',
    '- Stack: React, TypeScript e Tailwind CSS.',
    '- Sem dependência obrigatória de banco de dados ou APIs pagas.',
    '- Responsividade mobile-first, acessibilidade WCAG AA, prefers-reduced-motion e alvos de toque >= 44px.',
  ].join('\n');

  return {
    analyzedAt: new Date().toISOString(),
    originalInputUrl: collected.originalInputUrl,
    resolvedMapsUrl: verifiedGoogleMapsUrl,
    companyProfile,
    architecture,
    executiveReportMarkdown,
    finalBuildPrompt,
  };
}

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function classifyGeminiError(
  error: unknown,
  collectedData?: CollectedResearchData
): AnalysisErrorPayload {
  const errMsg = error instanceof Error ? error.message : String(error);
  const lower = errMsg.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('403') ||
    lower.includes('401')
  ) {
    return {
      status: 401,
      code: 'AUTH_ERROR',
      message:
        'A chave da API Gemini não está configurada ou é inválida. Os dados identificados na web foram preservados; gere o projeto agora mesmo com os dados disponíveis.',
      collectedData,
    };
  }

  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'Limite de requisições da API Gemini atingido (429 RESOURCE_EXHAUSTED). Os dados já coletados da empresa foram preservados. Aguarde alguns instantes para tentar novamente ou gere agora mesmo o projeto arquitetônico e o prompt final com os dados disponíveis.',
      collectedData,
    };
  }

  return {
    status: 500,
    code: 'UPSTREAM_ERROR',
    message: `A síntese via Gemini falhou (${errMsg}). Os dados identificados foram preservados para geração imediata.`,
    collectedData,
  };
}

async function runConsolidatedGeminiScan(collected: CollectedResearchData): Promise<ScannerBlueprintResult> {
  const fallback = buildBlueprintFromCollectedData(collected);

  const consolidatedPrompt = [
    'Você é o núcleo de inteligência arquitetônica do VIRA SCANNER 3D.',
    'Atue simultaneamente como arquiteto de aplicativos, designer UI/UX, diretor de arte, especialista em identidade visual, estrategista comercial e especialista em experiência mobile.',
    '',
    'REGRA PRINCIPAL: Seu produto final é EXCLUSIVAMENTE um projeto arquitetônico completo e UM ÚNICO PROMPT FINAL DE CONSTRUÇÃO para o aplicativo comercial desta empresa. Nunca construa o aplicativo da empresa.',
    '',
    'DADOS JÁ IDENTIFICADOS E CRUZADOS NAS FONTES PÚBLICAS:',
    `- Origem do link: ${collected.sourceOrigin || 'Página pública'} (${collected.originalInputUrl})`,
    `- Nome comercial: ${fallback.companyProfile.name} (status: ${collected.fieldStatuses?.name || 'unconfirmed'})`,
    collected.legalName ? `- Razão social: ${collected.legalName} (status: ${collected.fieldStatuses?.legalName || 'confirmed'})` : '',
    collected.cnpj ? `- CNPJ: ${collected.cnpj} (status: ${collected.fieldStatuses?.cnpj || 'confirmed'})` : '',
    collected.segment ? `- Segmento: ${collected.segment}` : '',
    collected.address ? `- Endereço: ${collected.address} (status: ${collected.fieldStatuses?.address || 'unconfirmed'})` : '- Endereço: Não localizado nas fontes públicas',
    collected.phone ? `- Telefone: ${collected.phone}` : '- Telefone: Não localizado',
    collected.whatsapp ? `- WhatsApp: ${collected.whatsapp}` : '',
    collected.hours ? `- Horários: ${collected.hours}` : '- Horários: Não localizados',
    collected.website ? `- Site oficial: ${collected.website}` : '- Site oficial: Não localizado',
    collected.instagram ? `- Instagram: ${collected.instagram}` : '- Instagram: Não localizado',
    collected.facebook ? `- Facebook: ${collected.facebook}` : '- Facebook: Não localizado',
    collected.googleMapsUrl ? `- Google Maps: ${collected.googleMapsUrl}` : '- Google Maps: Não localizado',
    collected.metaDescription ? `- Descrição pública: ${collected.metaDescription}` : '',
    collected.limitations && collected.limitations.length > 0
      ? `- Limitações registradas: ${collected.limitations.join(' | ')}`
      : '',
    '',
    'REGRAS DE VERACIDADE:',
    '- NUNCA invente telefones, endereços, CNPJs, horários, notas ou URLs que não estejam listados acima.',
    '- Mantenha `website`, `instagram`, `facebook` exatamente como acima (`null` quando ausentes).',
    '- Diferencie claramente informações confirmadas, encontradas mas não confirmadas, e não encontradas.',
    '',
    'FORMATO DE SAÍDA OBRIGATÓRIO:',
    'Retorne EXCLUSIVAMENTE um único objeto JSON válido em Português do Brasil com a seguinte estrutura:',
    JSON.stringify({
      companyProfile: fallback.companyProfile,
      architecture: fallback.architecture,
      executiveReportMarkdown: 'string',
      finalBuildPrompt: 'string',
    }),
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_ID,
    contents: consolidatedPrompt,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const parsed = extractJsonObject(response.text || '') as Partial<ScannerBlueprintResult>;
  const rawProfile = parsed.companyProfile;

  const mergedProfile: CompanyProfile = {
    ...fallback.companyProfile,
    ...rawProfile,
    legalName: collected.legalName ?? rawProfile?.legalName ?? null,
    cnpj: collected.cnpj ?? rawProfile?.cnpj ?? null,
    whatsapp: collected.whatsapp ?? rawProfile?.whatsapp ?? null,
    sourceOrigin: collected.sourceOrigin,
    fieldStatuses: collected.fieldStatuses,
    productsAndServices:
      Array.isArray(rawProfile?.productsAndServices) && rawProfile.productsAndServices.length > 0
        ? rawProfile.productsAndServices
        : fallback.companyProfile.productsAndServices,
    limitations:
      Array.isArray(rawProfile?.limitations) && rawProfile.limitations.length > 0
        ? rawProfile.limitations
        : fallback.companyProfile.limitations,
    socialLinks: {
      googleMapsUrl: collected.googleMapsUrl || collected.resolvedMapsUrl,
      website: normalizeHttpUrl(collected.website || rawProfile?.socialLinks?.website),
      instagram: normalizeHttpUrl(collected.instagram || rawProfile?.socialLinks?.instagram),
      facebook: normalizeHttpUrl(collected.facebook || rawProfile?.socialLinks?.facebook),
      linkedin: normalizeHttpUrl(collected.linkedin || rawProfile?.socialLinks?.linkedin),
    },
    verifiedSources: collected.verifiedSources,
  };

  const mergedArchitecture: AppArchitecture = {
    ...fallback.architecture,
    ...(parsed.architecture || {}),
  };

  return {
    analyzedAt: new Date().toISOString(),
    originalInputUrl: collected.originalInputUrl,
    resolvedMapsUrl: collected.googleMapsUrl || collected.resolvedMapsUrl,
    companyProfile: mergedProfile,
    architecture: mergedArchitecture,
    executiveReportMarkdown:
      typeof parsed.executiveReportMarkdown === 'string' && parsed.executiveReportMarkdown.trim()
        ? parsed.executiveReportMarkdown
        : fallback.executiveReportMarkdown,
    finalBuildPrompt:
      typeof parsed.finalBuildPrompt === 'string' && parsed.finalBuildPrompt.trim()
        ? parsed.finalBuildPrompt
        : fallback.finalBuildPrompt,
  };
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/blueprint-from-collected', (req: Request, res: Response) => {
    const collected = req.body?.collectedData as CollectedResearchData | undefined;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;

    if (!collected || typeof collected.resolvedMapsUrl !== 'string') {
      res.status(400).json({ error: 'Dados coletados inválidos ou ausentes para geração.' });
      return;
    }

    const result = buildBlueprintFromCollectedData(collected, reason);
    res.json(result);
  });

  app.post('/api/analyze', async (req: Request, res: Response) => {
    const rawInput =
      typeof req.body?.url === 'string'
        ? req.body.url.trim()
        : typeof req.body?.mapsUrl === 'string'
          ? req.body.mapsUrl.trim()
          : '';
    const forceRefresh = Boolean(req.body?.forceRefresh);

    if (!rawInput) {
      res.status(400).json({ error: 'Informe um link público relacionado à empresa para iniciar a identificação.' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawInput);
    } catch {
      res.status(400).json({
        error: 'O texto informado não é uma URL válida. Cole um link completo começando com https:// ou http://.',
      });
      return;
    }

    if (
      (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') ||
      isPrivateOrBlockedHost(parsedUrl.hostname)
    ) {
      res.status(400).json({
        error: 'Informe uma URL pública válida (Instagram, Facebook, CNPJ, site, Google Maps ou página pública).',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let collectedData: CollectedResearchData | undefined;

    try {
      collectedData = await runUniversalCompanyResearch(rawInput, (stage, detail) => {
        sendSse(res, 'status', { stage, detail });
      });

      const cacheKey = normalizeCacheKey(collectedData.resolvedMapsUrl, rawInput);

      if (!forceRefresh) {
        const cached = blueprintCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          sendSse(res, 'status', {
            stage: 'Recuperando análise consolidada',
            detail: 'Empresa identificada recentemente; reutilizando resultado sem nova chamada à API.',
          });
          sendSse(res, 'result', cached.result);
          res.end();
          return;
        }
      }

      // If no GEMINI_API_KEY is configured, complete seamlessly using the universal research engine!
      const hasGeminiKey =
        Boolean(process.env.GEMINI_API_KEY) &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';

      if (!hasGeminiKey) {
        sendSse(res, 'status', {
          stage: 'Consolidando projeto e prompt final',
          detail: 'Montando relatório arquitetônico com os dados públicos coletados (sem chave Gemini).',
        });
        const localResult = buildBlueprintFromCollectedData(
          collectedData,
          'Síntese arquitetônica gerada diretamente pelos dados públicos identificados (chave Gemini não configurada).'
        );
        blueprintCache.set(cacheKey, {
          result: localResult,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        sendSse(res, 'result', localResult);
        res.end();
        return;
      }

      sendSse(res, 'status', {
        stage: 'Projetando arquitetura 3D e prompt final',
        detail: collectedData.placeName
          ? `Sintetizando projeto arquitetônico e prompt de construção para "${collectedData.placeName}".`
          : 'Sintetizando projeto arquitetônico e prompt de construção com os dados identificados.',
      });

      let scanPromise = inFlightAnalyses.get(cacheKey);
      if (!scanPromise) {
        scanPromise = runConsolidatedGeminiScan(collectedData);
        inFlightAnalyses.set(cacheKey, scanPromise);
      }

      let finalResult: ScannerBlueprintResult;
      try {
        finalResult = await scanPromise;
      } finally {
        inFlightAnalyses.delete(cacheKey);
      }

      blueprintCache.set(cacheKey, {
        result: finalResult,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      sendSse(res, 'result', finalResult);
      res.end();
    } catch (error) {
      console.error('[VIRA SCANNER 3D] /api/analyze error:', error);
      const errorPayload = classifyGeminiError(error, collectedData);
      sendSse(res, 'error', errorPayload);
      res.end();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VIRA SCANNER 3D server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
