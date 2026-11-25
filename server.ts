import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import net from 'node:net';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  AnalysisErrorPayload,
  AppArchitecture,
  CollectedResearchData,
  CompanyProfile,
  ScannerBlueprintResult,
  VerifiedSource,
} from './src/types/blueprint.ts';

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

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const parts = lower.split('.').map(Number);
    const [a, b] = parts;
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }
  if (ipVersion === 6) {
    if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

function isAllowedGoogleMapsInput(urlObj: URL): boolean {
  const host = urlObj.hostname.toLowerCase();
  const pathName = urlObj.pathname.toLowerCase();

  if (host === 'maps.app.goo.gl' || host === 'g.page' || host === 'share.google') {
    return true;
  }
  if (host === 'goo.gl' && pathName.startsWith('/maps')) {
    return true;
  }
  if (host === 'maps.google.com' || host.startsWith('maps.google.')) {
    return true;
  }
  if ((host === 'google.com' || host.endsWith('.google.com') || host.includes('.google.')) && pathName.startsWith('/maps')) {
    return true;
  }
  return false;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaTag(html: string, attrName: string, attrValue: string): string | null {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternA = new RegExp(
    `<meta[^>]*${attrName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const patternB = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escaped}["'][^>]*>`,
    'i'
  );
  const match = html.match(patternA) || html.match(patternB);
  if (!match?.[1]) return null;
  const decoded = decodeHtmlEntities(match[1]);
  const lower = decoded.toLowerCase();
  if (
    !decoded ||
    lower === 'google maps' ||
    lower.includes('find local businesses, view maps and get driving directions') ||
    lower.includes('encontre empresas locais, visualize mapas e obtenha rotas')
  ) {
    return null;
  }
  return decoded;
}

async function safeResolveAndFetchMapsMeta(rawUrl: string): Promise<{
  resolvedUrl: string;
  metaTitle: string | null;
  metaDescription: string | null;
}> {
  let currentUrl = rawUrl;
  let lastHtml = '';
  const maxHops = 5;

  for (let i = 0; i < maxHops; i++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Protocolo de URL não permitido.');
    }
    if (isPrivateOrBlockedHost(parsed.hostname)) {
      throw new Error('Endereço de rede não permitido.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const resp = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ViraScanner3D/1.0)',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });

      const location = resp.headers.get('location');
      if (location && resp.status >= 300 && resp.status < 400) {
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (resp.ok && contentType.includes('text/html')) {
        lastHtml = (await resp.text()).slice(0, 150000);
      }
      currentUrl = resp.url || currentUrl;
      break;
    } catch {
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  let metaTitle: string | null = null;
  let metaDescription: string | null = null;

  if (lastHtml) {
    metaTitle =
      extractMetaTag(lastHtml, 'property', 'og:title') ||
      extractMetaTag(lastHtml, 'itemprop', 'name') ||
      null;
    metaDescription =
      extractMetaTag(lastHtml, 'property', 'og:description') ||
      extractMetaTag(lastHtml, 'name', 'description') ||
      null;

    if (!metaTitle) {
      const titleMatch = lastHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch?.[1]) {
        const cleanTitle = decodeHtmlEntities(titleMatch[1]).replace(/\s*-\s*Google Maps$/i, '').trim();
        if (cleanTitle && cleanTitle.toLowerCase() !== 'google maps') {
          metaTitle = cleanTitle;
        }
      }
    }
  }

  return { resolvedUrl: currentUrl, metaTitle, metaDescription };
}

function extractMapsHints(resolvedUrl: string): {
  placeName: string | null;
  latLng: { latitude: number; longitude: number } | null;
  queryHint: string | null;
} {
  let placeName: string | null = null;
  let latLng: { latitude: number; longitude: number } | null = null;
  let queryHint: string | null = null;

  try {
    const u = new URL(resolvedUrl);
    const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (placeMatch?.[1]) {
      placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
    }

    const coordMatch = resolvedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordMatch?.[1] && coordMatch?.[2]) {
      const latitude = Number(coordMatch[1]);
      const longitude = Number(coordMatch[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        latLng = { latitude, longitude };
      }
    }

    const q = u.searchParams.get('q') || u.searchParams.get('query');
    if (q) {
      queryHint = q.trim();
    }
  } catch {
    // Ignore parse errors
  }

  return { placeName, latLng, queryHint };
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'n/a') {
    return null;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return u.toString();
    }
  } catch {
    return null;
  }
  return null;
}

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

async function collectMapsPublicData(rawInput: string): Promise<CollectedResearchData> {
  const { resolvedUrl, metaTitle, metaDescription } = await safeResolveAndFetchMapsMeta(rawInput);
  const hints = extractMapsHints(resolvedUrl);

  const verifiedSources: VerifiedSource[] = [
    {
      title: metaTitle || hints.placeName || 'Link do Google Maps informado',
      url: resolvedUrl,
      sourceType: 'google_maps',
    },
  ];

  return {
    originalInputUrl: rawInput,
    resolvedMapsUrl: resolvedUrl,
    placeName: hints.placeName || metaTitle || hints.queryHint,
    queryHint: hints.queryHint,
    latLng: hints.latLng,
    metaTitle,
    metaDescription,
    verifiedSources,
    capturedAt: new Date().toISOString(),
  };
}

function buildBlueprintFromCollectedData(
  collected: CollectedResearchData,
  failureReason?: string
): ScannerBlueprintResult {
  const businessName =
    collected.placeName ||
    collected.metaTitle ||
    collected.queryHint ||
    'Empresa do Link Google Maps';

  const coordsText = collected.latLng
    ? `Coordenadas extraídas da URL: ${collected.latLng.latitude.toFixed(6)}, ${collected.latLng.longitude.toFixed(6)}`
    : 'Coordenadas geográficas não presentes na URL informada';

  const metaSummary = collected.metaDescription
    ? collected.metaDescription
    : 'Descrição pública não disponível nos metadados HTML da URL.';

  const limitations: string[] = [];
  if (failureReason) {
    limitations.push(failureReason);
  }
  limitations.push(
    'Endereço completo, telefone/WhatsApp, horários de funcionamento, avaliações detalhadas e redes sociais (Instagram, Facebook e site) não puderam ser verificados na web durante esta execução e não foram inventados.'
  );
  if (!collected.latLng) {
    limitations.push('A URL informada não continha coordenadas numéricas explícitas.');
  }

  const companyProfile: CompanyProfile = {
    name: businessName,
    category: collected.metaDescription
      ? `Extraído de metadados públicos (${collected.metaDescription})`
      : 'Não localizado nas fontes públicas consultadas (necessário confirmar segmento)',
    address: 'Não localizado nas fontes públicas consultadas (confirmar endereço completo antes do lançamento)',
    phone: 'Não localizado nas fontes públicas consultadas',
    hours: 'Não localizado nas fontes públicas consultadas',
    locationSummary: coordsText,
    productsAndServices: [
      'Catálogo principal de produtos/serviços a confirmar diretamente com o estabelecimento',
      'Atendimento comercial e dúvidas via canal direto (WhatsApp)',
      'Localização e rota guiada pelo Google Maps oficial',
    ],
    reviewsAndDifferentiators: collected.metaDescription
      ? `Referência pública capturada nos metadados do Maps: "${metaSummary}". Demais avaliações não acessadas devido à limitação da pesquisa.`
      : 'Avaliações detalhadas não acessadas devido à limitação de pesquisa. Recomenda-se incorporar provas sociais reais fornecidas pela empresa.',
    socialLinks: {
      googleMapsUrl: collected.resolvedMapsUrl,
      website: null,
      instagram: null,
      facebook: null,
    },
    visualReferences:
      'Fotografias do estabelecimento não acessadas automaticamente nesta etapa. Utilizar fotos reais autorizadas da fachada, ambiente e produtos fornecidas pela empresa.',
    identityAndPositioning: `Posicionamento arquitetado a partir do registro público "${businessName}" no Google Maps, priorizando confiança local, agilidade mobile e contato direto sem dependência de APIs pagas.`,
    verifiedSources: collected.verifiedSources,
    limitations,
  };

  const architecture: AppArchitecture = {
    conceptAndObjective: `Aplicativo web comercial e catálogo interativo mobile-first para "${businessName}", focado em apresentar a empresa com autoridade visual 3D, facilitar a navegação até o local via Google Maps e converter visitantes em atendimentos diretos no WhatsApp sem depender de servidores ou APIs pagas.`,
    targetAudience: {
      primaryPersona: `Clientes locais que encontraram "${businessName}" pelo Google Maps ou indicação e desejam consultar ofertas, horários confirmados e falar rapidamente pelo celular.`,
      secondaryPersona: 'Clientes recorrentes que acessam o link salvo na tela inicial ou bio do Instagram para contato rápido e novidades.',
      painPoints: [
        'Dificuldade em confirmar rapidamente o que a empresa oferece antes de se deslocar',
        'Falta de um botão direto e contextualizado para atendimento no WhatsApp',
        'Experiência fragmentada entre mapa, redes sociais e informações de contato',
      ],
      mobileHabits: 'Acesso predominante via smartphone em deslocamento, leitura rápida em blocos escaneáveis e preferência por botões grandes com ação imediata.',
    },
    visualIdentity: {
      styleDirection: 'Estética tecnológica comercial de alto contraste com superfícies em camadas 3D, bordas especulares sutis e destaques luminosos orientados à conversão.',
      atmosphere: 'Profissional, contemporânea, confiável e fluida, valorizando fotos reais da empresa quando inseridas pelo proprietário.',
      brandVoice: 'Direto, acolhedor, transparente e orientado a resolver a necessidade do cliente em poucos toques.',
      motif3D: 'Cartões com elevação espacial em perspectiva suave, iluminação direcional de estúdio e botões táteis arredondados com brilho neon calibrado.',
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
        usage: 'Painéis, cartões de serviços e barra de navegação com bordas sutis.',
      },
      {
        name: 'Ciano Neon Calibrado',
        hex: '#22D3EE',
        role: 'Acento Primário (10%)',
        usage: 'Botões principais de conversão, indicadores de estado ativo e foco.',
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
      rationale: 'Outfit entrega presença geométrica moderna nos títulos; Plus Jakarta Sans assegura leitura rápida em telas móveis; JetBrains Mono alinha horários, coordenadas e valores com precisão tabular.',
    },
    style3DAndEffects: {
      depthSystem: 'Hierarquia de elevação única com gradientes internos sutis, borda superior iluminada (inset highlight) e separação clara por espaço em branco.',
      lightingAndShadows: 'Sombras realistas multicamadas (0 20px 40px -16px rgba(0,0,0,0.7)) simulando iluminação superior suave.',
      neonAndAccentTreatment: 'Brilho ciano concentrado exclusivamente nos CTAs principais e estados de foco, evitando poluição visual.',
      microInteractions: 'Respostas táteis em <= 180ms usando apenas transform e opacity com curva cubic-bezier(0.16, 1, 0.3, 1).',
      buttonStyle: 'Botões em cápsula arredondada (rounded-full) com relevo 3D sutil, texto em uma linha e alvo de toque >= 44px no mobile.',
    },
    screens: [
      {
        id: 'home',
        name: 'Início & Apresentação',
        route: '/',
        purpose: `Apresentar "${businessName}" com impacto visual imediato e direcionar para WhatsApp ou rota no mapa.`,
        layoutStructure: 'Hero em destaque com título da empresa, resumo real verificado, dois CTAs arredondados e faixa de diferenciais.',
        keyComponents: ['Cabeçalho limpo de 3 zonas', 'Bloco Hero com profundidade 3D', 'Cartões de destaque de atendimento', 'Bloco de transparência de dados'],
        primaryButtons: ['Falar no WhatsApp', 'Traçar Rota no Google Maps'],
        userInteractions: ['Toque direto para abrir rota no Maps', 'Pré-visualização interativa dos destaques'],
      },
      {
        id: 'catalogo',
        name: 'Produtos & Serviços',
        route: '/servicos',
        purpose: 'Organizar o portfólio comercial da empresa com busca rápida e pedido contextualizado.',
        layoutStructure: 'Filtro segmentado por categoria no topo seguido de grade responsiva de cartões 3D com foto real e descrição objetiva.',
        keyComponents: ['Barra de busca instantânea', 'Filtros por categoria', 'Cartões 3D de item com botão de orçamento'],
        primaryButtons: ['Solicitar no WhatsApp', 'Ver Detalhes'],
        userInteractions: ['Filtragem em tempo real sem recarregar página', 'Seleção de item para preencher mensagem automática'],
      },
      {
        id: 'localizacao',
        name: 'Localização & Horários',
        route: '/localizacao',
        purpose: 'Facilitar a chegada física do cliente e exibir horários e contatos confirmados.',
        layoutStructure: 'Painel dividido com informações operacionais confirmadas, coordenadas reais e botão de rota externa.',
        keyComponents: ['Quadro de horários e endereço', 'Cartão de coordenadas/localização', 'Acesso rápido a canais verificados'],
        primaryButtons: ['Abrir no Google Maps', 'Copiar Endereço'],
        userInteractions: ['Cópia do endereço com confirmação instantânea', 'Redirecionamento direto para navegação GPS'],
      },
      {
        id: 'contato',
        name: 'Atendimento & Redes',
        route: '/contato',
        purpose: 'Centralizar o contato rápido via WhatsApp e os canais sociais reais da empresa.',
        layoutStructure: 'Formulário leve de pré-atendimento que monta uma mensagem estruturada para envio direto no WhatsApp sem exigir banco de dados.',
        keyComponents: ['Seletor de assunto', 'Campo de nome e dúvida', 'Links oficiais verificados'],
        primaryButtons: ['Enviar Mensagem no WhatsApp', 'Compartilhar Aplicativo'],
        userInteractions: ['Geração instantânea de link wa.me', 'Compartilhamento nativo via Web Share API'],
      },
    ],
    buttonsAndFeatures: [
      {
        label: 'Falar no WhatsApp',
        action: 'Abre link wa.me com mensagem contextualizada (após confirmação do número oficial pela empresa)',
        screenLocation: 'Início e Serviços',
        businessValue: 'Reduz atrito e acelera conversão de visitantes mobile em leads reais.',
      },
      {
        label: 'Abrir no Google Maps',
        action: `Direciona para a URL verificada (${collected.resolvedMapsUrl})`,
        screenLocation: 'Início e Localização',
        businessValue: 'Aumenta visitas presenciais com rota em 1 toque.',
      },
      {
        label: 'Solicitar Orçamento / Item',
        action: 'Preenche automaticamente o nome do produto/serviço na mensagem de contato',
        screenLocation: 'Produtos & Serviços',
        businessValue: 'Qualifica o atendimento desde a primeira mensagem.',
      },
      {
        label: 'Compartilhar Empresa',
        action: 'Aciona navigator.share ou copia o link do app para a área de transferência',
        screenLocation: 'Contato e Rodapé',
        businessValue: 'Estimula indicação orgânica boca a boca.',
      },
    ],
    navigationAndUX: {
      navigationPattern: 'Barra superior enxuta em desktop e barra inferior fixa acessível ao polegar no mobile (altura <= 12% da viewport).',
      userFlowSteps: [
        'Visitante abre o app a partir de link na bio, WhatsApp ou busca local',
        'Identifica imediatamente o nome da empresa, proposta e localização',
        'Explora serviços/produtos disponíveis e seleciona o item de interesse',
        'Finaliza com 1 toque para conversar no WhatsApp ou abrir rota no Google Maps',
      ],
      accessibilityNotes: 'Contraste mínimo 4.5:1, foco visível por teclado, alvos de toque >= 44px no mobile e respeito a prefers-reduced-motion.',
    },
    recommendedIntegrations: [
      {
        name: 'Google Maps Deep Link',
        category: 'Navegação e Localização',
        purpose: 'Abrir rotas e ficha oficial do estabelecimento diretamente no app Maps do usuário.',
        costTier: 'Gratuito (sem API paga)',
      },
      {
        name: 'WhatsApp Click-to-Chat (wa.me)',
        category: 'Conversão e Atendimento',
        purpose: 'Iniciar conversas com mensagem pré-preenchida sem exigir API Business paga.',
        costTier: 'Gratuito (padrão)',
      },
      {
        name: 'Web Share API + Clipboard',
        category: 'Crescimento Orgânico',
        purpose: 'Compartilhar o aplicativo e copiar dados de contato nativamente no navegador.',
        costTier: 'Gratuito (nativo do navegador)',
      },
    ],
    whatsappAndSocialStrategy: {
      whatsappFlow: 'Todos os botões de conversão montam uma mensagem estruturada informando origem (App Comercial) e assunto/produto escolhido, exigindo apenas a inserção do número oficial confirmado da empresa.',
      prefilledMessageTemplate: `Olá! Vim pelo aplicativo de ${businessName} e gostaria de confirmar disponibilidade e atendimento sobre: [Serviço/Produto].`,
      instagramFunnel: 'Colocar o link do aplicativo na bio do Instagram com destaque para "Catálogo e WhatsApp" e usar Stories com chamada direta para ação.',
      facebookAndLocalSeo: 'Manter link do aplicativo integrado à ficha do Google Meu Negócio e página do Facebook após confirmar os URLs oficiais com o proprietário.',
      retentionTactics: [
        'Instrução de "Adicionar à Tela Inicial" (PWA leve) para clientes recorrentes',
        'Atalho rápido para novidades e promoções sazonais editáveis em arquivo de configuração',
        'Link direto para incentivar novas avaliações positivas na ficha do Google Maps',
      ],
    },
  };

  const executiveReportMarkdown = [
    `# Relatório Arquitetônico — ${businessName}`,
    '',
    '## 1. Levantamento da Empresa (Dados Verificados)',
    `- **Nome:** ${companyProfile.name}`,
    `- **Link Google Maps Verificado:** ${collected.resolvedMapsUrl}`,
    `- **Localização / Coordenadas:** ${companyProfile.locationSummary}`,
    `- **Metadados Públicos Capturados:** ${collected.metaDescription || 'Não disponíveis nos metadados da URL'}`,
    `- **Endereço / Telefone / Horários:** Não localizados automaticamente devido à limitação da pesquisa. **Devem ser confirmados diretamente com o proprietário antes da publicação.**`,
    `- **Site / Instagram / Facebook:** Não localizados automaticamente (nenhum link inventado).`,
    '',
    '### Limitações Transparentes',
    ...limitations.map((l) => `- ${l}`),
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
    '1. DADOS REAIS VERIFICADOS DA EMPRESA (NUNCA INVENTE DADOS AUSENTES):',
    `- Nome da empresa: ${businessName}`,
    `- Link oficial no Google Maps: ${collected.resolvedMapsUrl}`,
    collected.latLng
      ? `- Coordenadas reais extraídas: ${collected.latLng.latitude}, ${collected.latLng.longitude}`
      : '- Coordenadas: não disponíveis na URL',
    collected.metaDescription
      ? `- Referência pública extraída do Maps: ${collected.metaDescription}`
      : '- Referência pública extraída do Maps: indisponível',
    '- ATENÇÃO OBRIGATÓRIA: Endereço completo, telefone/WhatsApp, horários, site, Instagram, Facebook e preços exatos NÃO foram coletados na pesquisa automática. Crie um arquivo central de configuração (`src/data/businessConfig.ts`) com marcadores claros de preenchimento (ex.: "A confirmar com a empresa") para esses campos, sem jamais inventar telefones, endereços, notas de avaliação ou URLs falsas.',
    '',
    '2. DIREÇÃO DE ARTE, IDENTIDADE VISUAL E ESTÉTICA 3D:',
    `- Estética: ${architecture.visualIdentity.styleDirection}`,
    `- Paleta de cores (60-30-10): ${architecture.colorPalette.map((c) => `${c.name} (${c.hex} - ${c.role})`).join('; ')}.`,
    `- Tipografia: Títulos em "${architecture.typography.displayFont}", corpo em "${architecture.typography.bodyFont}", números/horários em "${architecture.typography.monoFont}" (tabular-nums).`,
    `- Profundidade 3D e efeitos: ${architecture.style3DAndEffects.depthSystem} ${architecture.style3DAndEffects.lightingAndShadows} ${architecture.style3DAndEffects.neonAndAccentTreatment}`,
    `- Botões: ${architecture.style3DAndEffects.buttonStyle} com microinterações em <= 180ms (${architecture.style3DAndEffects.microInteractions}).`,
    '',
    '3. ARQUITETURA DAS TELAS E INTERAÇÕES:',
    ...architecture.screens.map(
      (s, i) =>
        `Tela ${i + 1} — ${s.name} (${s.route}): ${s.purpose} Layout: ${s.layoutStructure} Componentes: ${s.keyComponents.join(', ')}. Botões principais: ${s.primaryButtons.join(', ')}. Interações: ${s.userInteractions.join(', ')}.`
    ),
    '',
    '4. ESTRATÉGIA DE CONVERSÃO (WHATSAPP + MAPS GRATUITOS):',
    `- Botão principal de rota apontando para ${collected.resolvedMapsUrl}.`,
    `- Fluxo WhatsApp via link wa.me (quando o número oficial for inserido em businessConfig.ts) usando mensagem pré-preenchida: "${architecture.whatsappAndSocialStrategy.prefilledMessageTemplate}".`,
    '- Compartilhamento nativo via Web Share API com fallback de cópia para área de transferência.',
    '',
    '5. REQUISITOS TÉCNICOS E DE IMPLEMENTAÇÃO:',
    '- Stack: React, TypeScript e Tailwind CSS.',
    '- Não exigir banco de dados nem APIs pagas.',
    '- Responsividade mobile-first com navegação acessível ao polegar, contraste WCAG AA, suporte a prefers-reduced-motion e alvos de toque >= 44px.',
    '- Entregue o código completo, modularizado e funcional sem dados fictícios disfarçados de reais.',
  ].join('\n');

  return {
    analyzedAt: new Date().toISOString(),
    originalInputUrl: collected.originalInputUrl,
    resolvedMapsUrl: collected.resolvedMapsUrl,
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
        'A chave da API Gemini não está configurada ou é inválida. Verifique o painel Settings > Secrets no Google AI Studio.',
      collectedData,
    };
  }

  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      code: 'RATE_LIMITED',
      message:
        'Limite de requisições da API Gemini atingido (429 RESOURCE_EXHAUSTED). Os dados já coletados do link foram preservados. Aguarde alguns instantes para tentar novamente ou gere agora mesmo o projeto arquitetônico e o prompt final com os dados disponíveis.',
      collectedData,
    };
  }

  return {
    status: 500,
    code: 'UPSTREAM_ERROR',
    message: `Não foi possível concluir a pesquisa na API Gemini (${errMsg}). Os dados já coletados do link foram preservados.`,
    collectedData,
  };
}

async function runConsolidatedGeminiScan(collected: CollectedResearchData): Promise<ScannerBlueprintResult> {
  const consolidatedPrompt = [
    'Você é o núcleo de inteligência do VIRA SCANNER 3D.',
    'Atue simultaneamente como investigador comercial rigoroso, arquiteto de aplicativos, designer UI/UX, diretor de arte, especialista em identidade visual, estrategista comercial e especialista em experiência mobile.',
    '',
    'REGRA PRINCIPAL: Seu produto final é EXCLUSIVAMENTE um projeto arquitetônico completo e UM ÚNICO PROMPT FINAL DE CONSTRUÇÃO para o aplicativo comercial desta empresa. Nunca construa o aplicativo da empresa.',
    '',
    'DADOS JÁ COLETADOS DO LINK DO GOOGLE MAPS:',
    `- Link original informado: ${collected.originalInputUrl}`,
    `- Link resolvido: ${collected.resolvedMapsUrl}`,
    collected.placeName ? `- Nome extraído do link: ${collected.placeName}` : '',
    collected.queryHint ? `- Parâmetro de busca: ${collected.queryHint}` : '',
    collected.latLng ? `- Coordenadas: ${collected.latLng.latitude}, ${collected.latLng.longitude}` : '',
    collected.metaTitle ? `- Título público da página Maps: ${collected.metaTitle}` : '',
    collected.metaDescription ? `- Descrição pública da página Maps: ${collected.metaDescription}` : '',
    '',
    'INSTRUÇÕES DE PESQUISA E RIGOR (USE GOOGLE SEARCH COM PARCIMÔNIA):',
    '- Pesquise fatos públicos verificáveis da empresa: nome, categoria, endereço, telefone/WhatsApp, horários, localização, produtos/serviços, avaliações/diferenciais, site oficial, Instagram, Facebook, referências visuais e posicionamento.',
    '- NUNCA invente dados, telefones, endereços, horários, notas ou links. Se algo não for encontrado, escreva "Não localizado nas fontes públicas consultadas", deixe `website`/`instagram`/`facebook` como `null` e registre a limitação em `limitations`.',
    '',
    'FORMATO DE RESPOSTA OBRIGATÓRIO:',
    'Retorne EXCLUSIVAMENTE um único objeto JSON válido (sem texto fora do JSON) em Português do Brasil com as chaves exatas:',
    `{
  "companyProfile": {
    "name": "string",
    "category": "string",
    "address": "string",
    "phone": "string",
    "hours": "string",
    "locationSummary": "string",
    "productsAndServices": ["string"],
    "reviewsAndDifferentiators": "string",
    "socialLinks": {
      "googleMapsUrl": "${collected.resolvedMapsUrl}",
      "website": "string | null",
      "instagram": "string | null",
      "facebook": "string | null"
    },
    "visualReferences": "string",
    "identityAndPositioning": "string",
    "limitations": ["string"]
  },
  "architecture": {
    "conceptAndObjective": "string",
    "targetAudience": {
      "primaryPersona": "string",
      "secondaryPersona": "string",
      "painPoints": ["string"],
      "mobileHabits": "string"
    },
    "visualIdentity": {
      "styleDirection": "string",
      "atmosphere": "string",
      "brandVoice": "string",
      "motif3D": "string"
    },
    "colorPalette": [
      { "name": "string", "hex": "#RRGGBB", "role": "string", "usage": "string" }
    ],
    "typography": {
      "displayFont": "string",
      "bodyFont": "string",
      "monoFont": "string",
      "rationale": "string"
    },
    "style3DAndEffects": {
      "depthSystem": "string",
      "lightingAndShadows": "string",
      "neonAndAccentTreatment": "string",
      "microInteractions": "string",
      "buttonStyle": "string"
    },
    "screens": [
      {
        "id": "string",
        "name": "string",
        "route": "string",
        "purpose": "string",
        "layoutStructure": "string",
        "keyComponents": ["string"],
        "primaryButtons": ["string"],
        "userInteractions": ["string"]
      }
    ],
    "buttonsAndFeatures": [
      { "label": "string", "action": "string", "screenLocation": "string", "businessValue": "string" }
    ],
    "navigationAndUX": {
      "navigationPattern": "string",
      "userFlowSteps": ["string"],
      "accessibilityNotes": "string"
    },
    "recommendedIntegrations": [
      { "name": "string", "category": "string", "purpose": "string", "costTier": "string" }
    ],
    "whatsappAndSocialStrategy": {
      "whatsappFlow": "string",
      "prefilledMessageTemplate": "string",
      "instagramFunnel": "string",
      "facebookAndLocalSeo": "string",
      "retentionTactics": ["string"]
    }
  },
  "executiveReportMarkdown": "string (relatório completo em Markdown)",
  "finalBuildPrompt": "string (ÚNICO PROMPT FINAL DE CONSTRUÇÃO completo pronto para ChatGPT e Google AI Studio, contendo todos os dados coletados, limitações, identidade visual, arquitetura de todas as telas, botões, interações, direção de arte 3D e instruções técnicas)"
}`,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_ID,
    contents: consolidatedPrompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const verifiedSources: VerifiedSource[] = [...collected.verifiedSources];
  const seenUrls = new Set(verifiedSources.map((s) => s.url));
  const searchChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

  for (const chunk of searchChunks) {
    const cleanUrl = normalizeHttpUrl(chunk.web?.uri);
    if (!cleanUrl || seenUrls.has(cleanUrl)) continue;
    seenUrls.add(cleanUrl);
    verifiedSources.push({
      title: (chunk.web?.title || cleanUrl).trim(),
      url: cleanUrl,
      sourceType: 'web',
    });
  }

  const parsed = extractJsonObject(response.text || '') as Partial<ScannerBlueprintResult>;
  const fallback = buildBlueprintFromCollectedData({
    ...collected,
    verifiedSources,
  });

  const rawProfile = parsed.companyProfile;
  const companyProfile: CompanyProfile = {
    ...fallback.companyProfile,
    ...rawProfile,
    productsAndServices:
      Array.isArray(rawProfile?.productsAndServices) && rawProfile.productsAndServices.length > 0
        ? rawProfile.productsAndServices
        : fallback.companyProfile.productsAndServices,
    limitations:
      Array.isArray(rawProfile?.limitations) ? rawProfile.limitations : fallback.companyProfile.limitations,
    socialLinks: {
      googleMapsUrl: collected.resolvedMapsUrl,
      website: normalizeHttpUrl(rawProfile?.socialLinks?.website),
      instagram: normalizeHttpUrl(rawProfile?.socialLinks?.instagram),
      facebook: normalizeHttpUrl(rawProfile?.socialLinks?.facebook),
    },
    verifiedSources,
  };

  const architecture: AppArchitecture = {
    ...fallback.architecture,
    ...(parsed.architecture || {}),
  };

  return {
    analyzedAt: new Date().toISOString(),
    originalInputUrl: collected.originalInputUrl,
    resolvedMapsUrl: collected.resolvedMapsUrl,
    companyProfile,
    architecture,
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

    const result = buildBlueprintFromCollectedData(
      collected,
      reason || 'Projeto gerado diretamente a partir dos dados disponíveis do link informado.'
    );
    res.json(result);
  });

  app.post('/api/analyze', async (req: Request, res: Response) => {
    const rawInput = typeof req.body?.mapsUrl === 'string' ? req.body.mapsUrl.trim() : '';
    const forceRefresh = Boolean(req.body?.forceRefresh);

    if (!rawInput) {
      res.status(400).json({ error: 'Informe um link válido do Google Maps para iniciar a análise.' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawInput);
    } catch {
      res.status(400).json({ error: 'O texto informado não é uma URL válida. Cole o link completo do Google Maps.' });
      return;
    }

    if ((parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') || !isAllowedGoogleMapsInput(parsedUrl)) {
      res.status(400).json({
        error: 'Informe exclusivamente um link do Google Maps (ex: https://maps.app.goo.gl/... ou https://www.google.com/maps/place/...).',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let collectedData: CollectedResearchData | undefined;

    try {
      sendSse(res, 'status', {
        stage: 'Coletando metadados do Google Maps',
        detail: 'Resolvendo link e extraindo informações públicas sem consumir cota da API.',
      });

      collectedData = await collectMapsPublicData(rawInput);
      const cacheKey = normalizeCacheKey(collectedData.resolvedMapsUrl, rawInput);

      if (!forceRefresh) {
        const cached = blueprintCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          sendSse(res, 'status', {
            stage: 'Recuperando análise consolidada',
            detail: 'Empresa analisada recentemente; reutilizando resultado sem nova chamada à API.',
          });
          sendSse(res, 'result', cached.result);
          res.end();
          return;
        }
      }

      if (!process.env.GEMINI_API_KEY) {
        sendSse(res, 'error', {
          status: 401,
          code: 'AUTH_ERROR',
          message: 'Chave GEMINI_API_KEY ausente no ambiente do servidor. Configure-a em Settings > Secrets ou gere o projeto com os dados disponíveis.',
          collectedData,
        } satisfies AnalysisErrorPayload);
        res.end();
        return;
      }

      sendSse(res, 'status', {
        stage: 'Executando análise única consolidada',
        detail: collectedData.placeName
          ? `Investigando fontes públicas e arquitetando o aplicativo de "${collectedData.placeName}" em chamada única.`
          : 'Investigando fontes públicas e arquitetando o aplicativo em chamada única.',
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
