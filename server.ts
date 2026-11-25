import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import multer from 'multer';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  AnalysisErrorPayload,
  AppArchitecture,
  CollectedResearchData,
  CompanyProfile,
  ScannerBlueprintResult,
} from './src/types/blueprint.ts';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  interpretBusinessMaterial,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_COUNT,
  processUploadedFiles,
  type UploadedMaterialFile,
} from './server/inputInterpreter.ts';
import {
  normalizeHttpUrl,
  runUniversalCompanyResearchFromMaterial,
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

function normalizeCacheKey(collected: CollectedResearchData, rawInput: string): string {
  if (collected.cnpj) {
    return `cnpj:${collected.cnpj.replace(/\D/g, '')}`;
  }
  const urlCandidate = normalizeHttpUrl(collected.website || collected.instagram || collected.googleMapsUrl || collected.resolvedMapsUrl);
  if (urlCandidate) {
    try {
      const u = new URL(urlCandidate);
      return `url:${u.hostname.toLowerCase()}${u.pathname}${u.search}`.replace(/\/+$/, '');
    } catch {
      // fall through
    }
  }
  const nameKey = (collected.placeName || collected.legalName || rawInput)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const cityKey = (collected.cityState || '').toLowerCase().trim();
  return `name:${nameKey}|${cityKey}`;
}

function asNonEmptyString(val: unknown, fallback: string): string {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
}

function asStringArray(val: unknown, fallback: string[]): string[] {
  if (!Array.isArray(val)) return fallback;
  const cleaned = val
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeArchitecture(raw: unknown, fallback: AppArchitecture): AppArchitecture {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ta = (r.targetAudience && typeof r.targetAudience === 'object' ? r.targetAudience : {}) as Record<string, unknown>;
  const vi = (r.visualIdentity && typeof r.visualIdentity === 'object' ? r.visualIdentity : {}) as Record<string, unknown>;
  const ty = (r.typography && typeof r.typography === 'object' ? r.typography : {}) as Record<string, unknown>;
  const s3d = (r.style3DAndEffects && typeof r.style3DAndEffects === 'object' ? r.style3DAndEffects : {}) as Record<string, unknown>;
  const nav = (r.navigationAndUX && typeof r.navigationAndUX === 'object' ? r.navigationAndUX : {}) as Record<string, unknown>;
  const wa = (r.whatsappAndSocialStrategy && typeof r.whatsappAndSocialStrategy === 'object' ? r.whatsappAndSocialStrategy : {}) as Record<string, unknown>;

  const colorPalette =
    Array.isArray(r.colorPalette) && r.colorPalette.length > 0
      ? r.colorPalette
          .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
          .map((c, idx) => {
            const fb = fallback.colorPalette[idx] || fallback.colorPalette[0];
            return {
              name: asNonEmptyString(c.name, fb.name),
              hex: asNonEmptyString(c.hex, fb.hex),
              role: asNonEmptyString(c.role, fb.role),
              usage: asNonEmptyString(c.usage, fb.usage),
            };
          })
      : fallback.colorPalette;

  const screens =
    Array.isArray(r.screens) && r.screens.length > 0
      ? r.screens
          .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
          .map((s, idx) => {
            const fb = fallback.screens[idx] || fallback.screens[0];
            return {
              id: asNonEmptyString(s.id, fb.id),
              name: asNonEmptyString(s.name, fb.name),
              route: asNonEmptyString(s.route, fb.route),
              purpose: asNonEmptyString(s.purpose, fb.purpose),
              layoutStructure: asNonEmptyString(s.layoutStructure, fb.layoutStructure),
              keyComponents: asStringArray(s.keyComponents, fb.keyComponents),
              primaryButtons: asStringArray(s.primaryButtons, fb.primaryButtons),
              userInteractions: asStringArray(s.userInteractions, fb.userInteractions),
            };
          })
      : fallback.screens;

  const buttonsAndFeatures =
    Array.isArray(r.buttonsAndFeatures) && r.buttonsAndFeatures.length > 0
      ? r.buttonsAndFeatures
          .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === 'object'))
          .map((b, idx) => {
            const fb = fallback.buttonsAndFeatures[idx] || fallback.buttonsAndFeatures[0];
            return {
              label: asNonEmptyString(b.label, fb.label),
              action: asNonEmptyString(b.action, fb.action),
              screenLocation: asNonEmptyString(b.screenLocation, fb.screenLocation),
              businessValue: asNonEmptyString(b.businessValue, fb.businessValue),
            };
          })
      : fallback.buttonsAndFeatures;

  const recommendedIntegrations =
    Array.isArray(r.recommendedIntegrations) && r.recommendedIntegrations.length > 0
      ? r.recommendedIntegrations
          .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object'))
          .map((it, idx) => {
            const fb = fallback.recommendedIntegrations[idx] || fallback.recommendedIntegrations[0];
            return {
              name: asNonEmptyString(it.name, fb.name),
              category: asNonEmptyString(it.category, fb.category),
              purpose: asNonEmptyString(it.purpose, fb.purpose),
              costTier: asNonEmptyString(it.costTier, fb.costTier),
            };
          })
      : fallback.recommendedIntegrations;

  return {
    conceptAndObjective: asNonEmptyString(r.conceptAndObjective, fallback.conceptAndObjective),
    targetAudience: {
      primaryPersona: asNonEmptyString(ta.primaryPersona, fallback.targetAudience.primaryPersona),
      secondaryPersona: asNonEmptyString(ta.secondaryPersona, fallback.targetAudience.secondaryPersona),
      painPoints: asStringArray(ta.painPoints, fallback.targetAudience.painPoints),
      mobileHabits: asNonEmptyString(ta.mobileHabits, fallback.targetAudience.mobileHabits),
    },
    visualIdentity: {
      styleDirection: asNonEmptyString(vi.styleDirection, fallback.visualIdentity.styleDirection),
      atmosphere: asNonEmptyString(vi.atmosphere, fallback.visualIdentity.atmosphere),
      brandVoice: asNonEmptyString(vi.brandVoice, fallback.visualIdentity.brandVoice),
      motif3D: asNonEmptyString(vi.motif3D, fallback.visualIdentity.motif3D),
    },
    colorPalette,
    typography: {
      displayFont: asNonEmptyString(ty.displayFont, fallback.typography.displayFont),
      bodyFont: asNonEmptyString(ty.bodyFont, fallback.typography.bodyFont),
      monoFont: asNonEmptyString(ty.monoFont, fallback.typography.monoFont),
      rationale: asNonEmptyString(ty.rationale, fallback.typography.rationale),
    },
    style3DAndEffects: {
      depthSystem: asNonEmptyString(s3d.depthSystem, fallback.style3DAndEffects.depthSystem),
      lightingAndShadows: asNonEmptyString(s3d.lightingAndShadows, fallback.style3DAndEffects.lightingAndShadows),
      neonAndAccentTreatment: asNonEmptyString(s3d.neonAndAccentTreatment, fallback.style3DAndEffects.neonAndAccentTreatment),
      microInteractions: asNonEmptyString(s3d.microInteractions, fallback.style3DAndEffects.microInteractions),
      buttonStyle: asNonEmptyString(s3d.buttonStyle, fallback.style3DAndEffects.buttonStyle),
    },
    screens,
    buttonsAndFeatures,
    navigationAndUX: {
      navigationPattern: asNonEmptyString(nav.navigationPattern, fallback.navigationAndUX.navigationPattern),
      userFlowSteps: asStringArray(nav.userFlowSteps, fallback.navigationAndUX.userFlowSteps),
      accessibilityNotes: asNonEmptyString(nav.accessibilityNotes, fallback.navigationAndUX.accessibilityNotes),
    },
    recommendedIntegrations,
    whatsappAndSocialStrategy: {
      whatsappFlow: asNonEmptyString(wa.whatsappFlow, fallback.whatsappAndSocialStrategy.whatsappFlow),
      prefilledMessageTemplate: asNonEmptyString(
        wa.prefilledMessageTemplate,
        fallback.whatsappAndSocialStrategy.prefilledMessageTemplate
      ),
      instagramFunnel: asNonEmptyString(wa.instagramFunnel, fallback.whatsappAndSocialStrategy.instagramFunnel),
      facebookAndLocalSeo: asNonEmptyString(wa.facebookAndLocalSeo, fallback.whatsappAndSocialStrategy.facebookAndLocalSeo),
      retentionTactics: asStringArray(wa.retentionTactics, fallback.whatsappAndSocialStrategy.retentionTactics),
    },
  };
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

function renderExecutiveReportMarkdown(
  collected: CollectedResearchData,
  companyProfile: CompanyProfile,
  architecture: AppArchitecture
): string {
  const statusTag = (key: string): string => {
    const st = collected.fieldStatuses?.[key];
    if (st === 'confirmed') return 'Confirmada';
    if (st === 'unconfirmed') return 'Encontrada (não confirmada)';
    return 'Não encontrada';
  };

  return [
    `# Relatório Arquitetônico — ${companyProfile.name}`,
    '',
    '## 1. Identificação Universal da Empresa (Fontes Cruzadas)',
    `- **Origem da identificação:** ${collected.inputSummary || collected.sourceOrigin || 'Material enviado'}`,
    collected.maskedCpf ? `- **Proteção de dados:** CPF detectado mascarado (${collected.maskedCpf})` : '',
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
  ]
    .filter(Boolean)
    .join('\n\n');
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

  const verifiedGoogleMapsUrl =
    normalizeHttpUrl(collected.googleMapsUrl) ||
    normalizeHttpUrl(collected.resolvedMapsUrl) ||
    '';

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
        label: verifiedGoogleMapsUrl ? 'Abrir no Google Maps' : 'Abrir Canal Principal',
        action: verifiedGoogleMapsUrl
          ? `Direciona para o link verificado (${verifiedGoogleMapsUrl})`
          : 'Abre o canal oficial ou endereço confirmado na seção Localização',
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

  const executiveReportMarkdown = renderExecutiveReportMarkdown(collected, companyProfile, architecture);

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
        'A chave da API Gemini não está configurada ou é inválida. Os dados identificados foram preservados; gere o projeto agora mesmo com os dados disponíveis.',
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
    'Você é o núcleo arquitetônico do VIRA SCANNER 3D (arquiteto de apps, UI/UX, diretor de arte, branding, estrategista mobile).',
    'REGRA PRINCIPAL: Gere EXCLUSIVAMENTE um projeto arquitetônico personalizado (11 pilares) e UM ÚNICO PROMPT FINAL DE CONSTRUÇÃO para o aplicativo comercial desta empresa. Nunca construa o app.',
    '',
    'DADOS IDENTIFICADOS E VERIFICADOS (NUNCA INVENTE DADOS AUSENTES):',
    `- Origem: ${collected.inputSummary || collected.sourceOrigin || 'Material enviado'}`,
    `- Nome: ${fallback.companyProfile.name} (${collected.fieldStatuses?.name || 'unconfirmed'})`,
    collected.legalName ? `- Razão social: ${collected.legalName}` : '',
    collected.cnpj ? `- CNPJ: ${collected.cnpj}` : '',
    collected.segment ? `- Segmento: ${collected.segment}` : '',
    collected.address ? `- Endereço: ${collected.address}` : '- Endereço: Não localizado',
    collected.phone ? `- Telefone: ${collected.phone}` : '- Telefone: Não localizado',
    collected.whatsapp ? `- WhatsApp: ${collected.whatsapp}` : '',
    collected.hours ? `- Horários: ${collected.hours}` : '- Horários: Não localizados',
    collected.website ? `- Site: ${collected.website}` : '',
    collected.instagram ? `- Instagram: ${collected.instagram}` : '',
    collected.facebook ? `- Facebook: ${collected.facebook}` : '',
    collected.googleMapsUrl ? `- Maps: ${collected.googleMapsUrl}` : '',
    collected.metaDescription ? `- Descrição pública: ${collected.metaDescription}` : '',
    collected.limitations && collected.limitations.length > 0
      ? `- Limitações: ${collected.limitations.slice(0, 4).join(' | ')}`
      : '',
    '',
    'Retorne EXCLUSIVAMENTE um JSON válido em Português do Brasil com as chaves:',
    JSON.stringify({
      companyProfile: {
        category: fallback.companyProfile.category,
        productsAndServices: fallback.companyProfile.productsAndServices,
        reviewsAndDifferentiators: fallback.companyProfile.reviewsAndDifferentiators,
        identityAndPositioning: fallback.companyProfile.identityAndPositioning,
      },
      architecture: fallback.architecture,
      finalBuildPrompt: 'string (prompt único completo e autocontido com os dados reais, paleta, tipografia, estética 3D, telas, botões e requisitos técnicos)',
    }),
  ]
    .filter(Boolean)
    .join('\n');

  const geminiPromise = ai.models.generateContent({
    model: MODEL_ID,
    contents: consolidatedPrompt,
    config: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Tempo limite da API Gemini atingido (24s).')), 24000)
  );

  const response = await Promise.race([geminiPromise, timeoutPromise]);
  const parsed = extractJsonObject(response.text || '') as Partial<ScannerBlueprintResult>;
  const rawProfile = parsed.companyProfile;

  const mergedProfile: CompanyProfile = {
    ...fallback.companyProfile,
    category: asNonEmptyString(rawProfile?.category, fallback.companyProfile.category),
    reviewsAndDifferentiators: asNonEmptyString(
      rawProfile?.reviewsAndDifferentiators,
      fallback.companyProfile.reviewsAndDifferentiators
    ),
    identityAndPositioning: asNonEmptyString(
      rawProfile?.identityAndPositioning,
      fallback.companyProfile.identityAndPositioning
    ),
    productsAndServices: asStringArray(
      rawProfile?.productsAndServices,
      fallback.companyProfile.productsAndServices
    ),
    legalName: collected.legalName ?? null,
    cnpj: collected.cnpj ?? null,
    whatsapp: collected.whatsapp ?? null,
    sourceOrigin: collected.sourceOrigin,
    fieldStatuses: collected.fieldStatuses,
    limitations: fallback.companyProfile.limitations,
    socialLinks: fallback.companyProfile.socialLinks,
    verifiedSources: collected.verifiedSources,
  };

  const mergedArchitecture = sanitizeArchitecture(parsed.architecture, fallback.architecture);
  const executiveReportMarkdown = renderExecutiveReportMarkdown(
    collected,
    mergedProfile,
    mergedArchitecture
  );

  return {
    analyzedAt: new Date().toISOString(),
    originalInputUrl: collected.originalInputUrl,
    resolvedMapsUrl: fallback.resolvedMapsUrl,
    companyProfile: mergedProfile,
    architecture: mergedArchitecture,
    executiveReportMarkdown,
    finalBuildPrompt:
      typeof parsed.finalBuildPrompt === 'string' && parsed.finalBuildPrompt.trim()
        ? parsed.finalBuildPrompt
        : fallback.finalBuildPrompt,
  };
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_SIZE_BYTES,
      files: MAX_FILES_COUNT,
    },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || '').toLowerCase();
      const extOk = /\.(png|jpg|jpeg|webp|gif|pdf|txt|csv|json|md)$/i.test(file.originalname || '');
      if (ALLOWED_UPLOAD_MIME_TYPES.has(mime) || extOk) {
        cb(null, true);
      } else {
        cb(
          new Error(
            `Tipo de arquivo não suportado ("${file.originalname}"). Envie PNG, JPG, WEBP, GIF, PDF, TXT, CSV, JSON ou MD.`
          )
        );
      }
    },
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/blueprint-from-collected', (req: Request, res: Response) => {
    const collected = req.body?.collectedData as CollectedResearchData | undefined;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;

    const hasCollectedContent = Boolean(
      collected &&
        typeof collected === 'object' &&
        (collected.placeName ||
          collected.legalName ||
          collected.cnpj ||
          collected.inputSummary ||
          collected.originalInputUrl)
    );

    if (!hasCollectedContent || !collected) {
      res.status(400).json({ error: 'Dados coletados inválidos ou ausentes para geração.' });
      return;
    }

    const result = buildBlueprintFromCollectedData(collected, reason);
    res.json(result);
  });

  app.post('/api/analyze', (req: Request, res: Response) => {
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    const runPipeline = async (rawText: string, uploadedFiles: UploadedMaterialFile[], forceRefresh: boolean) => {
      if (!rawText && uploadedFiles.length === 0) {
        res.status(400).json({
          error:
            'Envie alguma informação da empresa: cole um texto, CNPJ, nome, endereço, link ou anexe uma imagem/documento.',
        });
        return;
      }

      const hasGeminiKey =
        Boolean(process.env.GEMINI_API_KEY) &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';

      // Prepare SSE only after basic input check succeeds, or validate interpreted signal before SSE?
      // Better: process uploaded files & interpret first so insufficient-signal returns crisp HTTP 400 JSON!
      // Wait: OCR can take ~1-4s; stream SSE right away so user sees OCR progress in UI,
      // OR check plain text sufficiency fast, and stream SSE for OCR + research!
      const isTextOnly = uploadedFiles.length === 0;
      let preInterpreted = isTextOnly
        ? interpretBusinessMaterial({ rawText, ocrText: null, documentText: null })
        : null;

      if (isTextOnly && preInterpreted && !preInterpreted.hasSufficientSignal) {
        res.status(400).json({
          error:
            'Não foi possível identificar nenhum indício empresarial válido (nome, CNPJ, telefone, endereço, @instagram ou link). Tente incluir mais detalhes.',
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      let collectedData: CollectedResearchData | undefined;

      try {
        if (!preInterpreted) {
          sendSse(res, 'status', {
            stage: 'Processando anexos e leitura OCR',
            detail: `Lendo ${uploadedFiles.length} arquivo(s) enviado(s) para extrair dados empresariais.`,
          });
          const extractedFiles = await processUploadedFiles(
            uploadedFiles,
            hasGeminiKey ? ai : null,
            (stage, detail) => sendSse(res, 'status', { stage, detail })
          );
          preInterpreted = interpretBusinessMaterial({
            rawText,
            ocrText: extractedFiles.ocrText,
            documentText: extractedFiles.documentText,
            notes: extractedFiles.notes,
            limitations: extractedFiles.limitations,
          });
        }

        if (!preInterpreted.hasSufficientSignal) {
          const errorPayload: AnalysisErrorPayload = {
            status: 400,
            code: 'INVALID_INPUT',
            message:
              'Não encontramos nome comercial, CNPJ, telefone, endereço ou link legível no material enviado. Tente digitar o nome/CNPJ ou enviar uma imagem mais nítida.',
          };
          sendSse(res, 'error', errorPayload);
          res.end();
          return;
        }

        sendSse(res, 'status', {
          stage: 'Identificando empresa',
          detail: preInterpreted.sourceSummary,
        });

        collectedData = await runUniversalCompanyResearchFromMaterial(preInterpreted, (stage, detail) => {
          sendSse(res, 'status', { stage, detail });
        });

        const cacheKey = normalizeCacheKey(collectedData, rawText);

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

        if (!hasGeminiKey) {
          sendSse(res, 'status', {
            stage: 'Consolidando projeto e prompt final',
            detail: 'Montando relatório arquitetônico com os dados públicos identificados (sem chave Gemini).',
          });
          const localResult = buildBlueprintFromCollectedData(
            collectedData,
            'Síntese arquitetônica gerada diretamente pelos dados identificados (chave Gemini não configurada).'
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
        if (errorPayload.code === 'UPSTREAM_ERROR' && collectedData) {
          sendSse(res, 'status', {
            stage: 'Consolidando projeto e prompt final',
            detail: 'Aplicando motor local com os dados verificados (síntese de IA temporariamente indisponível).',
          });
          const resilientResult = buildBlueprintFromCollectedData(
            collectedData,
            'Síntese arquitetônica gerada diretamente pelo motor local com os dados verificados (serviço de IA temporariamente indisponível).'
          );
          sendSse(res, 'result', resilientResult);
          res.end();
          return;
        }
        sendSse(res, 'error', errorPayload);
        res.end();
      }
    };

    if (contentType.includes('multipart/form-data')) {
      upload.array('files', MAX_FILES_COUNT)(req, res, (err) => {
        if (err) {
          const multerCode = (err as { code?: string }).code;
          const msg =
            multerCode === 'LIMIT_FILE_SIZE'
              ? 'Um dos arquivos excede o limite de 5 MB.'
              : multerCode === 'LIMIT_FILE_COUNT'
                ? `Envie no máximo ${MAX_FILES_COUNT} arquivos por identificação.`
                : err instanceof Error
                  ? err.message
                  : 'Falha ao processar os arquivos enviados.';
          res.status(400).json({ error: msg });
          return;
        }

        const rawText =
          typeof req.body?.text === 'string'
            ? req.body.text.trim()
            : typeof req.body?.url === 'string'
              ? req.body.url.trim()
              : typeof req.body?.mapsUrl === 'string'
                ? req.body.mapsUrl.trim()
                : '';
        const forceRefresh = req.body?.forceRefresh === 'true' || req.body?.forceRefresh === true;
        const expressFiles = Array.isArray(req.files) ? req.files : [];
        const uploadedFiles: UploadedMaterialFile[] = expressFiles.map((f) => ({
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          buffer: f.buffer,
        }));

        void runPipeline(rawText, uploadedFiles, forceRefresh);
      });
    } else {
      const rawText =
        typeof req.body?.text === 'string'
          ? req.body.text.trim()
          : typeof req.body?.url === 'string'
            ? req.body.url.trim()
            : typeof req.body?.mapsUrl === 'string'
              ? req.body.mapsUrl.trim()
              : '';
      const forceRefresh = Boolean(req.body?.forceRefresh);
      void runPipeline(rawText, [], forceRefresh);
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
