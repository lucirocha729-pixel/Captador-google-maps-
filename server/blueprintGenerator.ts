import type {
  AppArchitecture,
  BlueprintGenerationMeta,
  CollectedResearchData,
  CompanyProfile,
  ScannerBlueprintResult,
} from '../src/types/blueprint.ts';
import { processCollectedCompanyInfo } from './infoProcessor.ts';

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

export function sanitizeArchitecture(raw: unknown, fallback: AppArchitecture): AppArchitecture {
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

export function renderExecutiveReportMarkdown(
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

export function buildFinalBuildPrompt(
  collected: CollectedResearchData,
  companyProfile: CompanyProfile,
  architecture: AppArchitecture,
  whatsappTargetHint: string
): string {
  const statusTag = (key: string): string => {
    const st = collected.fieldStatuses?.[key];
    if (st === 'confirmed') return 'Confirmada';
    if (st === 'unconfirmed') return 'Encontrada (não confirmada)';
    return 'Não encontrada';
  };

  return [
    `Atue como engenheiro front-end sênior e designer UI/UX especialista em experiências 3D modernas. Construa o aplicativo web comercial oficial para a empresa "${companyProfile.name}".`,
    '',
    '1. DADOS IDENTIFICADOS E VERIFICADOS DA EMPRESA (NUNCA INVENTE DADOS NÃO LOCALIZADOS):',
    `- Nome comercial: ${companyProfile.name} (${statusTag('name')})`,
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
}

export function generateLocalBlueprint(
  collected: CollectedResearchData,
  extraLimitation?: string,
  meta?: BlueprintGenerationMeta
): ScannerBlueprintResult {
  const ctx = processCollectedCompanyInfo(collected, extraLimitation);

  const companyProfile: CompanyProfile = {
    name: ctx.businessName,
    legalName: ctx.legalName,
    cnpj: ctx.cnpj,
    sourceOrigin: collected.sourceOrigin,
    category: ctx.category,
    address: ctx.address,
    phone: ctx.phone,
    whatsapp: ctx.whatsapp,
    hours: ctx.hours,
    locationSummary: ctx.locationSummary,
    productsAndServices: ctx.productsAndServices,
    reviewsAndDifferentiators: ctx.reviewsAndDifferentiators,
    socialLinks: {
      googleMapsUrl: ctx.verifiedGoogleMapsUrl,
      website: ctx.website,
      instagram: ctx.instagram,
      facebook: ctx.facebook,
      linkedin: ctx.linkedin,
    },
    visualReferences: ctx.visualReferences,
    identityAndPositioning: ctx.identityAndPositioning,
    verifiedSources: collected.verifiedSources,
    limitations: ctx.limitations,
    fieldStatuses: ctx.fieldStatuses,
  };

  const architecture: AppArchitecture = {
    conceptAndObjective: `Aplicativo web comercial mobile-first para "${ctx.businessName}" (${ctx.archetypeLabel}), integrando os dados públicos reais identificados (${collected.sourceOrigin || 'identificação universal'}) com navegação 3D fluida, canais oficiais verificados e conversão imediata via WhatsApp.`,
    targetAudience: {
      primaryPersona: `Clientes que descobrem "${ctx.businessName}" via ${
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
    colorPalette: ctx.palette,
    typography: {
      displayFont: 'Outfit',
      bodyFont: 'Plus Jakarta Sans',
      monoFont: 'JetBrains Mono',
      rationale: 'Outfit entrega presença geométrica nos títulos; Plus Jakarta Sans assegura leitura rápida no mobile; JetBrains Mono alinha CNPJ, horários e telefones com precisão tabular.',
    },
    style3DAndEffects: {
      depthSystem: 'Hierarquia de elevação única com gradientes internos sutis, borda superior iluminada e separação clara por espaço em branco.',
      lightingAndShadows: 'Sombras realistas multicamadas (0 20px 40px -16px rgba(0,0,0,0.7)) simulando iluminação superior suave.',
      neonAndAccentTreatment: `Brilho ${ctx.palette[2]?.name || 'ciano'} concentrado exclusivamente nos CTAs principais e estados de foco.`,
      microInteractions: 'Respostas táteis em <= 180ms usando apenas transform e opacity com curva cubic-bezier(0.16, 1, 0.3, 1).',
      buttonStyle: 'Botões em cápsula arredondada (rounded-full) com relevo 3D sutil e alvo de toque >= 44px no mobile.',
    },
    screens: ctx.sectorScreens,
    buttonsAndFeatures: [
      {
        label: ctx.primaryCtaLabel,
        action: `Direciona para ${ctx.whatsappTargetHint} com mensagem contextualizada`,
        screenLocation: 'Início e Serviços',
        businessValue: 'Acelera a conversão de visitantes mobile em atendimentos reais.',
      },
      {
        label: ctx.verifiedGoogleMapsUrl ? 'Abrir no Google Maps' : 'Abrir Canal Principal',
        action: ctx.verifiedGoogleMapsUrl
          ? `Direciona para o link verificado (${ctx.verifiedGoogleMapsUrl})`
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
      whatsappFlow: `Os botões de ação montam uma mensagem estruturada com origem e interesse, conectando ao ${ctx.whatsappTargetHint}.`,
      prefilledMessageTemplate: `Olá! Vim pelo aplicativo de ${ctx.businessName} e gostaria de atendimento sobre: [Serviço/Produto].`,
      instagramFunnel: ctx.instagram
        ? `Integrar o app diretamente ao Instagram oficial verificado (${ctx.instagram}) e link na bio.`
        : 'Inserir o link do aplicativo na bio do Instagram oficial assim que o perfil for confirmado pela empresa.',
      facebookAndLocalSeo: ctx.facebook || ctx.website
        ? `Alinhar links cruzados entre o app${ctx.website ? `, site (${ctx.website})` : ''}${ctx.facebook ? ` e Facebook (${ctx.facebook})` : ''}.`
        : 'Consolidar o aplicativo na ficha do Google Meu Negócio e páginas sociais confirmadas pelo proprietário.',
      retentionTactics: [
        'Atalho "Adicionar à Tela Inicial" para acesso recorrente em 1 toque',
        'Seção atualizável de destaques comerciais em arquivo de configuração',
        'Convite discreto pós-atendimento para avaliação no Google Maps',
      ],
    },
  };

  const executiveReportMarkdown = renderExecutiveReportMarkdown(collected, companyProfile, architecture);
  const finalBuildPrompt = buildFinalBuildPrompt(
    collected,
    companyProfile,
    architecture,
    ctx.whatsappTargetHint
  );

  return {
    analyzedAt: new Date().toISOString(),
    originalInputUrl: collected.originalInputUrl,
    resolvedMapsUrl: ctx.verifiedGoogleMapsUrl,
    companyProfile,
    architecture,
    executiveReportMarkdown,
    finalBuildPrompt,
    meta,
  };
}
